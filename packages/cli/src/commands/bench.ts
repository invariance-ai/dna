import type { Command } from "commander";
import { readFile } from "node:fs/promises";
import path from "node:path";
import kleur from "kleur";
import { loadTasks, runBench } from "@invariance/dna-core";
import { addRootOption, resolveRoot, type RootOption } from "../root.js";

export function registerBench(program: Command): void {
  const bench = program.command("bench").description("Repo-edit-bench: A/B coding agents with and without DNA");

  addRootOption(
    bench
      .command("tasks")
      .description("List bench tasks")
      .option("--dir <path>", "Tasks directory (default bench/repo-edit-bench/tasks)"),
  ).action(async (opts: RootOption & { dir?: string }) => {
    const root = resolveRoot(opts);
    const dir = opts.dir ? path.resolve(root, opts.dir) : path.join(root, "bench/repo-edit-bench/tasks");
    const tasks = await loadTasks(dir);
    if (tasks.length === 0) {
      console.log(kleur.dim(`no tasks in ${path.relative(root, dir)}`));
      return;
    }
    for (const t of tasks) {
      console.log(`${kleur.cyan(t.id.padEnd(28))} ${kleur.dim(t.repo)}`);
      console.log(kleur.dim("  " + (t.prompt.split("\n")[0] ?? "").slice(0, 80)));
    }
  });

  addRootOption(
    bench
      .command("run")
      .description("Run bench: each task twice (baseline + dna) × n attempts")
      .option("--tasks <path>", "Tasks directory (default bench/repo-edit-bench/tasks)")
      .option("--out <path>", "Output directory (default bench/results/<timestamp>)")
      .option("--agent <cmd>", "Agent command (default: `claude -p`)")
      .option("--n <n>", "Attempts per (task, arm). Default 1")
      .option("--timeout <sec>", "Per-attempt timeout in seconds. Default 300"),
  ).action(async (opts: RootOption & { tasks?: string; out?: string; agent?: string; n?: string; timeout?: string }) => {
    const root = resolveRoot(opts);
    const tasksDir = opts.tasks ? path.resolve(root, opts.tasks) : path.join(root, "bench/repo-edit-bench/tasks");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outDir = opts.out ? path.resolve(root, opts.out) : path.join(root, "bench/results", stamp);
    const n = opts.n ? Number(opts.n) : 1;
    const timeoutSec = opts.timeout ? Number(opts.timeout) : 300;
    console.log(kleur.bold("bench run") + kleur.dim(`  tasks=${path.relative(root, tasksDir)} out=${path.relative(root, outDir)} n=${n}`));
    const summary = await runBench(root, tasksDir, outDir, {
      agentCommand: opts.agent,
      n,
      timeoutSec,
    });
    const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
    console.log(`\nbaseline pass ${pct(summary.baseline.pass_rate)}  •  dna pass ${pct(summary.dna.pass_rate)}  •  Δ ${pct(summary.dna.pass_rate - summary.baseline.pass_rate)}`);
    console.log(kleur.dim(`summary: ${path.relative(root, path.join(outDir, "summary.md"))}`));
  });

  addRootOption(
    bench
      .command("report")
      .description("Print the markdown report from a previous `dna bench run`")
      .option("--run <path>", "Results directory (default: latest under bench/results/)"),
  ).action(async (opts: RootOption & { run?: string }) => {
    const root = resolveRoot(opts);
    let dir = opts.run ? path.resolve(root, opts.run) : undefined;
    if (!dir) {
      const { readdir } = await import("node:fs/promises");
      const root2 = path.join(root, "bench/results");
      try {
        const entries = (await readdir(root2)).sort();
        if (entries.length === 0) throw new Error("no runs");
        dir = path.join(root2, entries[entries.length - 1]!);
      } catch {
        console.error(kleur.red("no runs found under bench/results/"));
        process.exitCode = 1;
        return;
      }
    }
    const md = await readFile(path.join(dir, "summary.md"), "utf8");
    console.log(md);
  });
}
