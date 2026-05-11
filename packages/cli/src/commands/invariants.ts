import type { Command } from "commander";

export function registerInvariants(program: Command): void {
  program
    .command("invariants")
    .description("dna invariants — not yet implemented")
    .action(async () => {
      console.log("dna invariants: not yet implemented");
      process.exitCode = 1;
    });
}
