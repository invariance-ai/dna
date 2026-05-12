import type { Command } from "commander";
import kleur from "kleur";
import { prepareEdit, recordPrepared } from "@invariance/dna-core";
import { addRootOption, resolveRoot, type RootOption } from "../root.js";

interface PrepareOpts extends RootOption {
  intent: string;
  json?: boolean;
  budget?: string;
  since?: string;
  depth?: string;
}

export function registerPrepare(program: Command): void {
  addRootOption(
    program
      .command("prepare <symbol>")
      .description("Decision-ready brief before editing a symbol (calls prepare_edit)")
      .option("--intent <text>", "What you plan to change", "(unspecified)")
      .option("--budget <tokens>", "Approximate token budget for the brief")
      .option("--since <when>", "Drop notes/decisions/questions older than this (ISO or 7d/2w/3mo)")
      .option("--depth <n>", "Neighborhood depth for callee context (1-3)")
      .option("--json", "Emit JSON instead of markdown"),
  ).action(async (symbol: string, opts: PrepareOpts) => {
    try {
      const root = resolveRoot(opts);
      const budget = opts.budget ? Number(opts.budget) : undefined;
      const depth = opts.depth ? Number(opts.depth) : undefined;
      if (budget !== undefined && (!Number.isFinite(budget) || budget <= 0)) {
        throw new Error("--budget must be a positive integer");
      }
      if (depth !== undefined && (!Number.isInteger(depth) || depth < 1 || depth > 3)) {
        throw new Error("--depth must be 1, 2, or 3");
      }
      const r = await prepareEdit(
        { symbol, intent: opts.intent, budget, since: opts.since, depth },
        root,
      );
      await recordPrepared(root, symbol).catch(() => {});
      if (opts.json) console.log(JSON.stringify(r, null, 2));
      else console.log(r.markdown);
    } catch (e) {
      console.error(kleur.red(`error: ${(e as Error).message}`));
      process.exitCode = 1;
    }
  });
}
