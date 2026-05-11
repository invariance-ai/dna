import type { Command } from "commander";
import kleur from "kleur";

export function registerServe(program: Command): void {
  program
    .command("serve")
    .description("Start the dna MCP server (stdio)")
    .action(async () => {
      // Lazy import: only load MCP deps when serving.
      try {
        await import("@invariance/dna-mcp/dist/server.js");
      } catch (e) {
        console.error(kleur.red(`failed to start MCP server: ${(e as Error).message}`));
        console.error(kleur.dim("hint: did the workspace build? run `pnpm build` from the repo root."));
        process.exitCode = 1;
      }
    });
}
