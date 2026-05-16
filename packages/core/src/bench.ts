import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const execFile = promisify(_execFile);

/**
 * Repo-edit-bench harness. Runs a coding agent (default: `claude -p`)
 * twice per task — once without DNA, once with — runs the task's checks,
 * and scores both. Output: per-run JSON + summary markdown.
 *
 * Deliberately minimal: this is the v1 surface, not the comprehensive
 * judge from the plan. Adds full judge-mode in a follow-up once we have
 * a stable corpus.
 */
export interface BenchTask {
  id: string;
  repo: string;
  prompt: string;
  checks: string[];
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
}

export interface BenchSummary {
  tasks: number;
  attempts_per_arm: number;
  baseline: { pass_rate: number; mean_duration_sec: number; mean_output_chars: number };
  dna:      { pass_rate: number; mean_duration_sec: number; mean_output_chars: number };
  per_task: Array<{ task_id: string; baseline_pass: number; dna_pass: number; delta: number }>;
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
  /** Repeat each (task, arm) N times to smooth variance. Default 1. */
  n?: number;
  /** Timeout per attempt in seconds. Default 300. */
  timeoutSec?: number;
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

  const prompt = arm === "dna"
    ? `${task.prompt}\n\nUse the dna MCP server (get_context, impact_of, tests_for, invariants_for) before editing.`
    : task.prompt;

  const t0 = Date.now();
  let output = "";
  try {
    const [bin, ...args] = agentCommand.split(/\s+/);
    if (!bin) throw new Error("empty agentCommand");
    const { stdout } = await execFile(bin, [...args, prompt], {
      cwd: repoPath,
      timeout: timeoutSec * 1000,
      maxBuffer: 32 * 1024 * 1024,
    });
    output = stdout;
  } catch (err) {
    // Agent failure → recorded as fail with whatever output we got.
    output = (err as { stdout?: string }).stdout ?? "";
  }
  const duration_sec = (Date.now() - t0) / 1000;

  const failed_checks: string[] = [];
  for (const check of task.checks) {
    try {
      await execFile("sh", ["-c", check], { cwd: repoPath, timeout: 60_000 });
    } catch {
      failed_checks.push(check);
    }
  }

  return {
    task_id: task.id,
    arm,
    attempt,
    passed: failed_checks.length === 0,
    failed_checks,
    duration_sec,
    output_chars: output.length,
  };
}

export async function runBench(
  repoRoot: string,
  tasksDir: string,
  outDir: string,
  opts: RunOptions = {},
): Promise<BenchSummary> {
  const tasks = await loadTasks(tasksDir);
  const n = opts.n ?? 1;
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

  return {
    tasks: tasks.length,
    attempts_per_arm: n,
    baseline: {
      pass_rate: baseline.length === 0 ? 0 : baseline.filter((r) => r.passed).length / baseline.length,
      mean_duration_sec: meanOf(baseline.map((r) => r.duration_sec)),
      mean_output_chars: meanOf(baseline.map((r) => r.output_chars)),
    },
    dna: {
      pass_rate: dna.length === 0 ? 0 : dna.filter((r) => r.passed).length / dna.length,
      mean_duration_sec: meanOf(dna.map((r) => r.duration_sec)),
      mean_output_chars: meanOf(dna.map((r) => r.output_chars)),
    },
    per_task,
  };
}

function renderMarkdown(s: BenchSummary): string {
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push(`# repo-edit-bench summary`);
  lines.push("");
  lines.push(`${s.tasks} task(s) × ${s.attempts_per_arm} attempt(s) × 2 arm(s).`);
  lines.push("");
  lines.push(`| arm | pass rate | mean duration (s) | mean output (chars) |`);
  lines.push(`|---|---|---|---|`);
  lines.push(`| baseline | ${pct(s.baseline.pass_rate)} | ${s.baseline.mean_duration_sec.toFixed(1)} | ${s.baseline.mean_output_chars.toFixed(0)} |`);
  lines.push(`| dna      | ${pct(s.dna.pass_rate)}      | ${s.dna.mean_duration_sec.toFixed(1)}      | ${s.dna.mean_output_chars.toFixed(0)} |`);
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
