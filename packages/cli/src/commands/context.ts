import type { Command } from "commander";
import kleur from "kleur";
import { getContext, formatContextPretty, formatContextMarkdown } from "@invariance/dna-core";

export function registerContext(program: Command): void {
  program
    .command("context <symbol>")
    .description("Full multi-strand context for a symbol")
    .option("--json", "Emit JSON (best for tool chaining)")
    .option("--markdown", "Emit markdown (best for piping into an LLM)")
    .option("--depth <n>", "Caller/callee depth", (v) => parseInt(v, 10), 2)
    .action(async (symbol: string, opts: { json?: boolean; markdown?: boolean; depth: number }) => {
      const root = process.cwd();
      try {
        const r = await getContext({ symbol, depth: opts.depth, strands: ["structural", "tests", "provenance", "invariants"] }, root);
        if (opts.json) console.log(JSON.stringify(r, null, 2));
        else if (opts.markdown) console.log(formatContextMarkdown(r));
        else console.log(formatContextPretty(r));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(kleur.red(`error: ${msg}`));
        if (msg.includes("ENOENT") || msg.includes("symbols.json")) {
          console.error(kleur.dim(`hint: run ${kleur.bold("dna init && dna index")} first.`));
        }
        process.exitCode = 1;
      }
    });
}
