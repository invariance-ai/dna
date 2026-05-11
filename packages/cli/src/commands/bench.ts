import type { Command } from "commander";

export function registerBench(program: Command): void {
  program
    .command("bench")
    .description("dna bench — not yet implemented")
    .action(async () => {
      console.log("dna bench: not yet implemented");
      process.exitCode = 1;
    });
}
