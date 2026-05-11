import type { Command } from "commander";
import kleur from "kleur";
import { prepareEdit } from "@invariance/dna-core";
import { addRootOption, resolveRoot, type RootOption } from "../root.js";

export function registerPrepare(program: Command): void {
  addRootOption(program
    .command("prepare <symbol>")
    .description("Decision-ready brief before editing a symbol (calls prepare_edit)")
    .option("--intent <text>", "What you plan to change", "(unspecified)")
    .option("--json", "Emit JSON instead of markdown"))
    .action(async (symbol: string, opts: RootOption & { intent: string; json?: boolean }) => {
      try {
        const r = await prepareEdit({ symbol, intent: opts.intent }, resolveRoot(opts));
        if (opts.json) console.log(JSON.stringify(r, null, 2));
        else console.log(r.markdown);
      } catch (e) {
        console.error(kleur.red(`error: ${(e as Error).message}`));
        process.exitCode = 1;
      }
    });
}
