import type { Command } from "commander";
import kleur from "kleur";
import { loadInvariants, invariantsFor, formatInvariantsPretty } from "@invariance/dna-core";
import { addRootOption, resolveRoot, type RootOption } from "../root.js";

export function registerInvariants(program: Command): void {
  addRootOption(program
    .command("invariants [symbol]")
    .description("Invariants that apply to a symbol (or list all)")
    .option("--json", "Emit JSON instead of pretty output"))
    .action(async (symbol: string | undefined, opts: RootOption & { json?: boolean }) => {
      const root = resolveRoot(opts);
      const all = await loadInvariants(root);
      const filtered = symbol ? invariantsFor(symbol, all) : all;
      if (opts.json) {
        console.log(JSON.stringify({ symbol: symbol ?? null, invariants: filtered }, null, 2));
        return;
      }
      if (!symbol) {
        if (all.length === 0) {
          console.log(kleur.dim("No invariants declared. Add some to .dna/invariants.yml."));
          return;
        }
        console.log(kleur.bold(`${all.length} invariant(s) declared:`));
        for (const inv of all) console.log(`  - ${kleur.cyan(inv.name)} ${kleur.dim(`[${inv.severity}]`)}`);
        return;
      }
      console.log(formatInvariantsPretty(symbol, filtered));
    });
}
