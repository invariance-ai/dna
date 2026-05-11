import type { Command } from "commander";
import kleur from "kleur";

export function registerBench(program: Command): void {
  program
    .command("bench")
    .description("Run repo-edit-bench (harness lands in v0.2)")
    .action(async () => {
      console.log(kleur.bold("repo-edit-bench"));
      console.log(kleur.dim("Harness ships in v0.2. See bench/repo-edit-bench/README.md for the spec."));
      console.log(kleur.dim("Simulated baseline: docs/simulated-benchmark.md"));
    });
}
