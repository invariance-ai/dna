import type { Command } from "commander";
import kleur from "kleur";
import {
  open as openQuery,
  resolveSymbol,
  testsForSymbol,
  formatTestsPretty,
} from "@invariance/dna-core";
import { addRootOption, resolveRoot, type RootOption } from "../root.js";

export function registerTests(program: Command): void {
  addRootOption(program
    .command("tests <symbol>")
    .description("Tests likely to cover a symbol — what to run after editing")
    .option("--json", "Emit JSON instead of pretty output"))
    .action(async (symbol: string, opts: RootOption & { json?: boolean }) => {
      const root = resolveRoot(opts);
      try {
        const ctx = await openQuery(root);
        const sym = resolveSymbol(symbol, ctx);
        if (!sym) throw new Error(`symbol not found: ${symbol}`);
        const tests = await testsForSymbol(sym.name, sym.file, root, ctx.index);
        if (opts.json) console.log(JSON.stringify({ symbol: sym, tests }, null, 2));
        else console.log(formatTestsPretty(sym.name, tests));
      } catch (e) {
        console.error(kleur.red(`error: ${(e as Error).message}`));
        process.exitCode = 1;
      }
    });
}
