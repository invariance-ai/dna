import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile, mkdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DNA_MCP_CONFIG, parseShellArgs, resetWorkingTree, runTask, type BenchTask } from "./bench.js";

const execFile = promisify(_execFile);
const roots: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(d);
  return d;
}

afterEach(async () => {
  while (roots.length) {
    const r = roots.pop();
    if (r) await rm(r, { recursive: true, force: true });
  }
});

async function gitInit(repo: string): Promise<void> {
  await execFile("git", ["-C", repo, "init", "-q", "-b", "main"]);
  await execFile("git", ["-C", repo, "config", "user.email", "bench@test"]);
  await execFile("git", ["-C", repo, "config", "user.name", "bench"]);
  await execFile("git", ["-C", repo, "config", "commit.gpgsign", "false"]);
}

describe("parseShellArgs", () => {
  it("splits simple whitespace", () => {
    expect(parseShellArgs("claude -p")).toEqual(["claude", "-p"]);
  });
  it("preserves double-quoted args with =", () => {
    expect(parseShellArgs(`claude -p --model="claude-opus-4-7"`)).toEqual([
      "claude", "-p", "--model=claude-opus-4-7",
    ]);
  });
  it("handles single quotes literally", () => {
    expect(parseShellArgs(`sh -c 'echo hi'`)).toEqual(["sh", "-c", "echo hi"]);
  });
  it("handles spaces inside quotes", () => {
    expect(parseShellArgs(`foo "a b c" d`)).toEqual(["foo", "a b c", "d"]);
  });
  it("handles backslash escapes outside quotes", () => {
    expect(parseShellArgs(`foo a\\ b`)).toEqual(["foo", "a b"]);
  });
  it("throws on unterminated quote", () => {
    expect(() => parseShellArgs(`foo "bar`)).toThrow(/unterminated quote/);
  });
  it("collapses multiple whitespace", () => {
    expect(parseShellArgs("  a   b  ")).toEqual(["a", "b"]);
  });
});

describe("resetWorkingTree", () => {
  it("discards edits, removes untracked files, and nukes .dna/", { timeout: 30_000 }, async () => {
    const repo = await tempDir("dna-bench-reset-");
    await gitInit(repo);
    await writeFile(path.join(repo, "tracked.txt"), "original\n");
    await execFile("git", ["-C", repo, "add", "."]);
    await execFile("git", ["-C", repo, "commit", "-q", "-m", "init"]);

    // dirty everything
    await writeFile(path.join(repo, "tracked.txt"), "MUTATED\n");
    await writeFile(path.join(repo, "untracked.txt"), "leak\n");
    await mkdir(path.join(repo, ".dna"), { recursive: true });
    await writeFile(path.join(repo, ".dna/index.json"), "{}\n");
    await mkdir(path.join(repo, "newdir"), { recursive: true });
    await writeFile(path.join(repo, "newdir/x"), "x\n");

    await resetWorkingTree(repo);

    expect((await readFile(path.join(repo, "tracked.txt"), "utf8"))).toBe("original\n");
    await expect(stat(path.join(repo, "untracked.txt"))).rejects.toThrow();
    await expect(stat(path.join(repo, ".dna"))).rejects.toThrow();
    await expect(stat(path.join(repo, "newdir"))).rejects.toThrow();
  });

  it("throws loudly when path is not a git repo", { timeout: 15_000 }, async () => {
    const notRepo = await tempDir("dna-bench-notrepo-");
    await expect(resetWorkingTree(notRepo)).rejects.toThrow(/not a git repo/);
  });

  it("also scrubs .mcp.json so dna-arm config does not leak to baseline arm",
    { timeout: 30_000 }, async () => {
    const repo = await tempDir("dna-bench-mcp-leak-");
    await gitInit(repo);
    await writeFile(path.join(repo, "tracked.txt"), "ok\n");
    await execFile("git", ["-C", repo, "add", "."]);
    await execFile("git", ["-C", repo, "commit", "-q", "-m", "init"]);

    // simulate the dna arm having written .mcp.json
    await writeFile(path.join(repo, ".mcp.json"), JSON.stringify(DNA_MCP_CONFIG));

    await resetWorkingTree(repo);

    await expect(stat(path.join(repo, ".mcp.json"))).rejects.toThrow();
  });
});

describe("prompt fairness (runTask)", () => {
  // To assert "both arms get an identical prompt" without booting `claude`,
  // we use a fake agentCommand that echoes its argv into a file in cwd. The
  // test reads the recorded prompts back and asserts byte-equality.
  async function setupRecordingRepo(): Promise<{ repo: string; task: BenchTask }> {
    const repo = await tempDir("dna-bench-fair-");
    await gitInit(repo);
    await writeFile(path.join(repo, "README.md"), "fixture\n");
    await execFile("git", ["-C", repo, "add", "."]);
    await execFile("git", ["-C", repo, "commit", "-q", "-m", "init"]);

    const task: BenchTask = {
      id: "fair-test",
      repo: ".",
      // Multiline + special chars so any extra suffix on the dna arm would be
      // immediately visible as a diff between recorded files.
      prompt: "Edit src/foo.ts and add a comment.\n\nKeep it concise.",
      checks: ["true"],
    };
    return { repo, task };
  }

  it("both arms receive byte-identical prompt argv", { timeout: 30_000 }, async () => {
    const { repo, task } = await setupRecordingRepo();
    // Write records OUTSIDE repo so the next attempt's resetWorkingTree
    // (which scrubs untracked files) cannot delete them. JSON-encode the
    // path to safely embed it inside the inline node -e source.
    const outDir = await tempDir("dna-bench-fair-out-");
    // Use single-quoted wrapper for the node -e script so the inner double-
    // quoted path literal isn't terminated by parseShellArgs.
    const recorder = (tag: string): string => {
      const target = path.join(outDir, `agent-${tag}.txt`);
      return `node -e 'require("fs").writeFileSync("${target}", process.argv[1] ?? "")'`;
    };

    const baseRes = await runTask(repo, task, "baseline", 0, { agentCommand: recorder("baseline"), timeoutSec: 30 });
    const dnaRes  = await runTask(repo, task, "dna",      0, { agentCommand: recorder("dna"),      timeoutSec: 30 });
    expect(baseRes.timed_out).toBe(false);
    expect(dnaRes.timed_out).toBe(false);

    const basePrompt = await readFile(path.join(outDir, "agent-baseline.txt"), "utf8");
    const dnaPrompt  = await readFile(path.join(outDir, "agent-dna.txt"), "utf8");
    expect(basePrompt).toBe(dnaPrompt);
    expect(basePrompt).toBe(task.prompt);
    // and specifically NOT the old appended suffix
    expect(dnaPrompt).not.toMatch(/MCP server/i);
  });

  it("dna arm writes .mcp.json into the workdir; baseline arm does not",
    { timeout: 30_000 }, async () => {
    const { repo, task } = await setupRecordingRepo();
    const outDir = await tempDir("dna-bench-mcp-out-");
    // Snapshot the .mcp.json that exists in cwd at agent invocation time,
    // OUTSIDE the repo so the next attempt's reset cannot wipe the snapshot.
    const snap = (tag: string): string => {
      const target = path.join(outDir, `snap-${tag}.json`);
      return `node -e 'try{require("fs").copyFileSync(".mcp.json", "${target}")}catch(e){}'`;
    };

    await runTask(repo, task, "dna", 0, { agentCommand: snap("dna"), timeoutSec: 30 });
    // baseline must NOT see a leftover .mcp.json from the prior dna attempt
    await runTask(repo, task, "baseline", 0, { agentCommand: snap("baseline"), timeoutSec: 30 });

    const dnaSnap = await stat(path.join(outDir, "snap-dna.json")).then(() => true).catch(() => false);
    const baseSnap = await stat(path.join(outDir, "snap-baseline.json")).then(() => true).catch(() => false);
    expect(dnaSnap).toBe(true);
    expect(baseSnap).toBe(false);

    const parsed = JSON.parse(await readFile(path.join(outDir, "snap-dna.json"), "utf8"));
    expect(parsed).toEqual(DNA_MCP_CONFIG);
  });
});
