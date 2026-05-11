import type { Command } from "commander";
import kleur from "kleur";
import { readIndex } from "@invariance/dna-core";

export function registerFind(program: Command): void {
  program
    .command("find <query>")
    .description("Fuzzy search for symbols")
    .option("--json", "Emit JSON instead of pretty output")
    .option("--limit <n>", "Max results", (v) => parseInt(v, 10), 20)
    .action(async (query: string, opts: { json?: boolean; limit: number }) => {
      const root = process.cwd();
      try {
        const index = await readIndex(root);
        const q = query.toLowerCase();
        const scored = index.symbols
          .map((s) => {
            const name = s.name.toLowerCase();
            let score = 0;
            if (name === q) score = 100;
            else if (name.startsWith(q)) score = 80;
            else if (name.includes(q)) score = 60;
            else return null;
            return { s, score };
          })
          .filter((x): x is { s: typeof index.symbols[0]; score: number } => !!x)
          .sort((a, b) => b.score - a.score)
          .slice(0, opts.limit);
        if (opts.json) {
          console.log(JSON.stringify(scored.map((x) => x.s), null, 2));
          return;
        }
        if (scored.length === 0) {
          console.log(kleur.dim(`no symbols match "${query}"`));
          return;
        }
        for (const { s } of scored) {
          console.log(`${s.name}  ${kleur.dim(`(${s.kind})  ${s.file}:${s.line}`)}`);
        }
      } catch (e) {
        console.error(kleur.red(`error: ${(e as Error).message}`));
        process.exitCode = 1;
      }
    });
}
