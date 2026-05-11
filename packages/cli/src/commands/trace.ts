import type { Command } from "commander";

export function registerTrace(program: Command): void {
  program
    .command("trace")
    .description("dna trace — not yet implemented")
    .action(async () => {
      console.log("dna trace: not yet implemented");
      process.exitCode = 1;
    });
}
