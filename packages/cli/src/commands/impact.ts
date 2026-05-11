import type { Command } from "commander";
import kleur from "kleur";
import { impactOf, formatImpactPretty, formatImpactMarkdown } from "@invariance/dna-core";

export function registerImpact(program: Command): void {
  program
    .command("impact <symbol>")
    .description("Blast radius (symbols, files, tests) of changing a symbol")
    .option("--json", "Emit JSON (best for tool chaining)")
    .option("--markdown", "Emit markdown (best for piping into an LLM)")
    .option("--hops <n>", "Transitive caller depth", (v) => parseInt(v, 10), 3)
    .action(async (symbol: string, opts: { json?: boolean; markdown?: boolean; hops: number }) => {
      try {
        const r = await impactOf({ symbol, hops: opts.hops }, process.cwd());
        if (opts.json) console.log(JSON.stringify(r, null, 2));
        else if (opts.markdown) console.log(formatImpactMarkdown(r));
        else console.log(formatImpactPretty(r));
      } catch (e) {
        console.error(kleur.red(`error: ${(e as Error).message}`));
        process.exitCode = 1;
      }
    });
}
