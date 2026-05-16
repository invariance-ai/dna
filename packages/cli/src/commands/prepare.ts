import type { Command } from "commander";
import kleur from "kleur";
import { prepareEdit, recordPrepared, inferSymbols, topSymbols } from "@invariance/dna-core";
import { addRootOption, resolveRoot, type RootOption } from "../root.js";

interface PrepareOpts extends RootOption {
  intent: string;
  json?: boolean;
  budget?: string;
  since?: string;
  depth?: string;
  fromPrompt?: string;
  feature?: string;
}

export function registerPrepare(program: Command): void {
  addRootOption(
    program
      .command("prepare [symbol]")
      .description("Decision-ready brief before editing a symbol (calls prepare_edit)")
      .option("--intent <text>", "What you plan to change", "(unspecified)")
      .option("--budget <tokens>", "Approximate token budget for the brief")
      .option("--since <when>", "Drop notes/decisions/questions older than this (ISO or 7d/2w/3mo)")
      .option("--depth <n>", "Neighborhood depth for callee context (1-3)")
      .option("--from-prompt <text>", "Infer the symbol from a natural-language prompt")
      .option("--feature <label>", "Use the feature's top symbol when no symbol is given")
      .option("--json", "Emit JSON instead of markdown"),
  ).action(async (symbolArg: string | undefined, opts: PrepareOpts) => {
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

      let symbol = symbolArg;
      if (!symbol && opts.feature) {
        const top = await topSymbols(root, opts.feature, 1);
        if (top.length === 0) throw new Error(`feature "${opts.feature}" has no symbols (run \`dna feature attribute\` first)`);
        const id = top[0]!.id;
        const hash = id.indexOf("#");
        const tail = hash >= 0 ? id.slice(hash + 1) : id;
        const colon = tail.lastIndexOf(":");
        symbol = colon > 0 ? tail.slice(0, colon) : tail;
        if (!opts.json) {
          console.error(kleur.dim(`using top symbol "${symbol}" from feature "${opts.feature}"`));
        }
      }
      // --from-prompt is now an alias of --intent; keep both for backcompat.
      const intentText = (opts.fromPrompt && opts.fromPrompt.trim())
        || (opts.intent && opts.intent !== "(unspecified)" ? opts.intent : undefined);
      let candidates: Array<{ symbol: string; score: number; via: string }> = [];
      let lowConfidence = false;
      if (!symbol && intentText) {
        const matches = await inferSymbols(root, intentText, { limit: 5 });
        if (matches.length === 0) {
          throw new Error(`no symbol matches for intent; try \`dna plan "${intentText}"\``);
        }
        candidates = matches.map((m) => ({
          symbol: m.symbol.qualified_name ?? m.symbol.name,
          score: m.score,
          via: m.via,
        }));
        const top = matches[0]!;
        symbol = top.symbol.qualified_name ?? top.symbol.name;
        const LOW_CONFIDENCE_THRESHOLD = 70;
        lowConfidence = candidates.length === 1 && top.score < LOW_CONFIDENCE_THRESHOLD;
        if (!opts.json) {
          console.error(
            kleur.dim(`inferred symbol "${symbol}" (confidence ${top.score}, via ${top.via}) from intent`),
          );
          if (lowConfidence) {
            console.error(
              kleur.yellow(
                `warning: only one candidate matched and confidence is low (${top.score}/100). ` +
                `Consider passing the symbol explicitly with \`--symbol\` or as a positional arg.`,
              ),
            );
          }
          if (candidates.length > 1) {
            const others = candidates.slice(1, 4)
              .map((c) => `${c.symbol} (${c.score})`).join(", ");
            console.error(kleur.dim(`other candidates: ${others}`));
          }
        }
      }
      if (!symbol) {
        throw new Error("symbol is required (or pass --intent <text> / --feature <label>)");
      }

      const r = await prepareEdit(
        { symbol, intent: opts.intent, budget, since: opts.since, depth },
        root,
      );
      await recordPrepared(root, symbol).catch(() => {});
      const withCandidates = candidates.length > 1
        ? { ...r, candidates, ...(lowConfidence ? { low_confidence: true } : {}) }
        : (lowConfidence ? { ...r, low_confidence: true } : r);
      if (opts.json) console.log(JSON.stringify(withCandidates, null, 2));
      else {
        console.log(r.markdown);
        if (candidates.length > 1) {
          console.log("\n## Candidates");
          for (const c of candidates) console.log(`- ${c.symbol} (score=${c.score}, via=${c.via})`);
          console.log(kleur.dim("\nPass the symbol name directly to lock the choice."));
        }
      }
    } catch (e) {
      console.error(kleur.red(`error: ${(e as Error).message}`));
      process.exitCode = 1;
    }
  });
}
