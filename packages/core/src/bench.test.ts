import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile, mkdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseShellArgs, resetWorkingTree } from "./bench.js";

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
  it("discards edits, removes untracked files, and nukes .dna/", async () => {
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

  it("throws loudly when path is not a git repo", async () => {
    const notRepo = await tempDir("dna-bench-notrepo-");
    await expect(resetWorkingTree(notRepo)).rejects.toThrow(/not a git repo/);
  });
});
