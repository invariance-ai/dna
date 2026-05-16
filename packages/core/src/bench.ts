import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, mkdir, writeFile, rm, mkdtemp, cp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const execFile = promisify(_execFile);

/**
 * Repo-edit-bench harness. Runs a coding agent (default: `claude -p`)
 * across two arms (without DNA, with DNA) for N attempts per (task, arm),
 * runs the task's checks, and scores both.
 *
 * Critical invariant: every attempt runs in a clean working tree. We reset
 * (or copy to a fresh tmpdir) before each attempt so arm-1's edits and
 * any `.dna/` artifacts cannot leak into arm-2.
 */
export interface BenchTask {
  id: string;
  repo: string;
  prompt: string;
  checks: string[];
  /**
   * @deprecated Not yet wired into checks. Kept for forward-compat;
   * if you need invariant checking today, encode it as a shell `check`.
   */
  invariants_expected?: string[];
}

export interface RunResult {
  task_id: string;
  arm: "baseline" | "dna";
  attempt: number;
  /** Whether all `checks` exited 0. */
  passed: boolean;
  failed_checks: string[];
  /** Seconds spent in the agent subprocess. */
  duration_sec: number;
  /** Stdout characters from the agent (proxy for token spend). */
  output_chars: number;
  /** True if the agent process hit the timeout. Checks are skipped in this case. */
  timed_out: boolean;
}

export interface BenchSummary {
  tasks: number;
  attempts_per_arm: number;
  baseline: { pass_rate: number; mean_duration_sec: number; mean_output_chars: number; timed_out: number };
  dna:      { pass_rate: number; mean_duration_sec: number; mean_output_chars: number; timed_out: number };
  per_task: Array<{ task_id: string; baseline_pass: number; dna_pass: number; delta: number }>;
  warnings: string[];
}

export async function loadTasks(dir: string): Promise<BenchTask[]> {
  const entries = await readdir(dir);
  const tasks: BenchTask[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;
    const raw = await readFile(path.join(dir, entry), "utf8");
    const parsed = parseYaml(raw) as Omit<BenchTask, "id">;
    tasks.push({ id: entry.replace(/\.(yml|yaml)$/, ""), ...parsed });
  }
  return tasks;
}

export interface RunOptions {
  /** Override the agent command. Default: `claude -p`. */
  agentCommand?: string;
  /** Repeat each (task, arm) N times to smooth variance. Default 3. */
  n?: number;
  /** Timeout per attempt in seconds. Default 300. */
  timeoutSec?: number;
}

/**
 * Minimal POSIX-ish shell-style argv parser. Handles:
 *   - whitespace splitting
 *   - single quotes (literal, no escapes inside)
 *   - double quotes (allows \" and \\ escapes)
 *   - backslash escape outside quotes
 * Sufficient for command strings like:
 *   claude -p --model="claude-opus-4-7"
 *   sh -c 'echo "hi there"'
 * Throws on unterminated quotes — fail loudly rather than silently mis-tokenize.
 */
export function parseShellArgs(input: string): string[] {
  const argv: string[] = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  let hasToken = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (inSingle) {
      if (c === "'") { inSingle = false; } else { cur += c; }
      continue;
    }
    if (inDouble) {
      if (c === "\\" && i + 1 < input.length) {
        const next = input[i + 1]!;
        if (next === '"' || next === "\\" || next === "$" || next === "`") { cur += next; i++; continue; }
        cur += c; continue;
      }
      if (c === '"') { inDouble = false; } else { cur += c; }
      continue;
    }
    if (c === "'") { inSingle = true; hasToken = true; continue; }
    if (c === '"') { inDouble = true; hasToken = true; continue; }
    if (c === "\\" && i + 1 < input.length) { cur += input[i + 1]!; i++; hasToken = true; continue; }
    if (/\s/.test(c)) {
      if (hasToken) { argv.push(cur); cur = ""; hasToken = false; }
      continue;
    }
    cur += c; hasToken = true;
  }
  if (inSingle || inDouble) throw new Error(`unterminated quote in agentCommand: ${input}`);
  if (hasToken) argv.push(cur);
  return argv;
}

/**
 * Hard reset the working tree to HEAD: discard tracked-file edits, remove
 * untracked files & dirs (including `.dna/`), then also nuke `.dna/` for
 * good measure (it's gitignored in some setups).
 *
 * Throws if repoPath isn't a git repo or git returns non-zero — the bench
 * cannot produce meaningful numbers if state can't be reset between arms.
 */
export async function resetWorkingTree(repoPath: string): Promise<void> {
  try {
    await execFile("git", ["-C", repoPath, "rev-parse", "--is-inside-work-tree"]);
  } catch (err) {
    throw new Error(
      `bench reset: ${repoPath} is not a git repo (cannot guarantee a clean state between arms). ` +
      `Use copy-mode (set up tasks against a git repo) or initialize a repo there. cause=${(err as Error).message}`,
    );
  }
  await execFile("git", ["-C", repoPath, "checkout", "--", "."]);
  await execFile("git", ["-C", repoPath, "clean", "-fd"]);
  await rm(path.join(repoPath, ".dna"), { recursive: true, force: true });
}

/**
 * Returns a callable that yields a clean repo path for a single attempt and
 * a cleanup hook to dispose it. Two modes:
 *   - if repoPath is a git repo: reset it in place and return its path.
 *   - otherwise: copy it to a fresh tmpdir per attempt and return that.
 */
async function prepareRepoForAttempt(repoPath: string): Promise<{ workPath: string; dispose: () => Promise<void> }> {
  let isRepo = false;
  try {
    await execFile("git", ["-C", repoPath, "rev-parse", "--is-inside-work-tree"]);
    isRepo = true;
  } catch { /* not a git repo */ }
  try { await stat(repoPath); } catch {
    throw new Error(`bench: task.repo path does not exist: ${repoPath}`);
  }
  if (isRepo) {
    await resetWorkingTree(repoPath);
    return { workPath: repoPath, dispose: async () => { /* in-place; reset on next attempt */ } };
  }
  const tmp = await mkdtemp(path.join(os.tmpdir(), "dna-bench-"));
  await cp(repoPath, tmp, { recursive: true });
  return { workPath: tmp, dispose: async () => { await rm(tmp, { recursive: true, force: true }); } };
}

export async function runTask(
  repoRoot: string,
  task: BenchTask,
  arm: "baseline" | "dna",
  attempt: number,
  opts: RunOptions = {},
): Promise<RunResult> {
  const agentCommand = opts.agentCommand ?? "claude -p";
  const timeoutSec = opts.timeoutSec ?? 300;
  const repoPath = path.resolve(repoRoot, task.repo);

  const { workPath, dispose } = await prepareRepoForAttempt(repoPath);

  const prompt = arm === "dna"
    ? `${task.prompt}\n\nUse the dna MCP server (get_context, impact_of, tests_for, invariants_for) before editing.`
    : task.prompt;

  const t0 = Date.now();
  let output = "";
  let timed_out = false;
  try {
    const argv = parseShellArgs(agentCommand);
    const [bin, ...args] = argv;
    if (!bin) throw new Error("empty agentCommand");
    const { stdout } = await execFile(bin, [...args, prompt], {
      cwd: workPath,
      timeout: timeoutSec * 1000,
      maxBuffer: 32 * 1024 * 1024,
    });
    output = stdout;
  } catch (err) {
    const e = err as { stdout?: string; killed?: boolean; signal?: string; code?: string | number };
    output = e.stdout ?? "";
    // node's execFile sets killed=true and signal='SIGTERM' on timeout
    if (e.killed === true || e.signal === "SIGTERM" || e.code === "ETIMEDOUT") {
      timed_out = true;
    }
  }
  const duration_sec = (Date.now() - t0) / 1000;

  const failed_checks: string[] = [];
  if (!timed_out) {
    for (const check of task.checks) {
      try {
        await execFile("sh", ["-c", check], { cwd: workPath, timeout: 60_000 });
      } catch {
        failed_checks.push(check);
      }
    }
  }

  try { await dispose(); } catch { /* best-effort cleanup */ }

  return {
    task_id: task.id,
    arm,
    attempt,
    passed: !timed_out && failed_checks.length === 0,
    failed_checks,
    duration_sec,
    output_chars: output.length,
    timed_out,
  };
}

export async function runBench(
  repoRoot: string,
  tasksDir: string,
  outDir: string,
  opts: RunOptions = {},
): Promise<BenchSummary> {
  const tasks = await loadTasks(tasksDir);
  const n = opts.n ?? 3;
  await mkdir(outDir, { recursive: true });

  const results: RunResult[] = [];
  for (const task of tasks) {
    for (let attempt = 0; attempt < n; attempt++) {
      for (const arm of ["baseline", "dna"] as const) {
        const r = await runTask(repoRoot, task, arm, attempt, opts);
        results.push(r);
        await writeFile(
          path.join(outDir, `${task.id}.${arm}.${attempt}.json`),
          JSON.stringify(r, null, 2),
        );
      }
    }
  }

  const summary = summarize(results, n);
  await writeFile(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  await writeFile(path.join(outDir, "summary.md"), renderMarkdown(summary));
  return summary;
}

export function summarize(results: RunResult[], n: number): BenchSummary {
  const tasks = [...new Set(results.map((r) => r.task_id))];
  const armResults = (arm: "baseline" | "dna"): RunResult[] => results.filter((r) => r.arm === arm);

  const meanOf = (arr: number[]): number =>
    arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;

  const baseline = armResults("baseline");
  const dna = armResults("dna");

  const per_task = tasks.map((tid) => {
    const b = baseline.filter((r) => r.task_id === tid);
    const d = dna.filter((r) => r.task_id === tid);
    const bp = b.length === 0 ? 0 : b.filter((r) => r.passed).length / b.length;
    const dp = d.length === 0 ? 0 : d.filter((r) => r.passed).length / d.length;
    return { task_id: tid, baseline_pass: bp, dna_pass: dp, delta: dp - bp };
  });

  const warnings: string[] = [];
  if (n < 3) {
    warnings.push(`n=${n} attempts per arm is below 3; results are not statistically meaningful (high variance).`);
  }

  return {
    tasks: tasks.length,
    attempts_per_arm: n,
    baseline: {
      pass_rate: baseline.length === 0 ? 0 : baseline.filter((r) => r.passed).length / baseline.length,
      mean_duration_sec: meanOf(baseline.map((r) => r.duration_sec)),
      mean_output_chars: meanOf(baseline.map((r) => r.output_chars)),
      timed_out: baseline.filter((r) => r.timed_out).length,
    },
    dna: {
      pass_rate: dna.length === 0 ? 0 : dna.filter((r) => r.passed).length / dna.length,
      mean_duration_sec: meanOf(dna.map((r) => r.duration_sec)),
      mean_output_chars: meanOf(dna.map((r) => r.output_chars)),
      timed_out: dna.filter((r) => r.timed_out).length,
    },
    per_task,
    warnings,
  };
}

function renderMarkdown(s: BenchSummary): string {
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push(`# repo-edit-bench summary`);
  lines.push("");
  lines.push(`${s.tasks} task(s) × ${s.attempts_per_arm} attempt(s) × 2 arm(s).`);
  lines.push("");
  for (const w of s.warnings) {
    lines.push(`> WARNING: ${w}`);
  }
  if (s.warnings.length > 0) lines.push("");
  lines.push(`| arm | pass rate | mean duration (s) | mean output (chars) | timed out |`);
  lines.push(`|---|---|---|---|---|`);
  lines.push(`| baseline | ${pct(s.baseline.pass_rate)} | ${s.baseline.mean_duration_sec.toFixed(1)} | ${s.baseline.mean_output_chars.toFixed(0)} | ${s.baseline.timed_out} |`);
  lines.push(`| dna      | ${pct(s.dna.pass_rate)}      | ${s.dna.mean_duration_sec.toFixed(1)}      | ${s.dna.mean_output_chars.toFixed(0)}      | ${s.dna.timed_out} |`);
  lines.push("");
  lines.push(`## Per task`);
  lines.push("");
  lines.push(`| task | baseline | dna | delta |`);
  lines.push(`|---|---|---|---|`);
  for (const t of s.per_task) {
    lines.push(`| ${t.task_id} | ${pct(t.baseline_pass)} | ${pct(t.dna_pass)} | ${(t.delta * 100).toFixed(1)}pp |`);
  }
  return lines.join("\n") + "\n";
}
