import type { Command } from "commander";

export function registerFind(program: Command): void {
  program
    .command("find")
    .description("dna find — not yet implemented")
    .action(async () => {
      console.log("dna find: not yet implemented");
      process.exitCode = 1;
    });
}
