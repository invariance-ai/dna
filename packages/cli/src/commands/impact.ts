import type { Command } from "commander";

export function registerImpact(program: Command): void {
  program
    .command("impact")
    .description("dna impact — not yet implemented")
    .action(async () => {
      console.log("dna impact: not yet implemented");
      process.exitCode = 1;
    });
}
