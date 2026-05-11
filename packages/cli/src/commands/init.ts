import type { Command } from "commander";

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("dna init — not yet implemented")
    .action(async () => {
      console.log("dna init: not yet implemented");
      process.exitCode = 1;
    });
}
