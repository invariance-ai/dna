import type { Command } from "commander";
import kleur from "kleur";
import { getContext, formatContextPretty, formatContextMarkdown } from "@invariance/dna-core";
import { addRootOption, resolveRoot, type RootOption } from "../root.js";

interface ContextOpts extends RootOption {
  json?: boolean;
  markdown?: boolean;
  depth: number;
  since?: string;
  authoredBy?: string;
}

export function registerContext(program: Command): void {
  addRootOption(
    program
      .command("context <symbol>")
      .description("Full multi-strand context for a symbol")
      .option("--json", "Emit JSON (best for tool chaining)")
      .option("--markdown", "Emit markdown (best for piping into an LLM)")
      .option("--depth <n>", "Caller/callee depth", (v) => parseInt(v, 10), 2)
      .option("--since <when>", "Drop notes/decisions/provenance older than this (ISO or 7d/2w/3mo)")
      .option("--authored-by <name>", "Filter decisions + provenance to one author"),
  ).action(async (symbol: string, opts: ContextOpts) => {
    const root = resolveRoot(opts);
    try {
      const r = await getContext(
        {
          symbol,
          depth: opts.depth,
          strands: ["structural", "tests", "provenance", "invariants"],
          since: opts.since,
          authored_by: opts.authoredBy,
        },
        root,
      );
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
