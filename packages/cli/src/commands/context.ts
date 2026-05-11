import type { Command } from "commander";

export function registerContext(program: Command): void {
  program
    .command("context")
    .description("dna context — not yet implemented")
    .action(async () => {
      console.log("dna context: not yet implemented");
      process.exitCode = 1;
    });
}
