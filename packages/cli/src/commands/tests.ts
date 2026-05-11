import type { Command } from "commander";

export function registerTests(program: Command): void {
  program
    .command("tests")
    .description("dna tests — not yet implemented")
    .action(async () => {
      console.log("dna tests: not yet implemented");
      process.exitCode = 1;
    });
}
