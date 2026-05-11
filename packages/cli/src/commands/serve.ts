import type { Command } from "commander";

export function registerServe(program: Command): void {
  program
    .command("serve")
    .description("dna serve — not yet implemented")
    .action(async () => {
      console.log("dna serve: not yet implemented");
      process.exitCode = 1;
    });
}
