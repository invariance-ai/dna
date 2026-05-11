import type { Command } from "commander";

export function registerIndex(program: Command): void {
  program
    .command("index")
    .description("dna index — not yet implemented")
    .action(async () => {
      console.log("dna index: not yet implemented");
      process.exitCode = 1;
    });
}
