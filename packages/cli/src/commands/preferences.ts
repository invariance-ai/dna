import type { Command } from "commander";
import kleur from "kleur";
import { loadPreferences } from "@invariance/dna-core";
import { addRootOption, resolveRoot, type RootOption } from "../root.js";

interface Opts extends RootOption {
  topic?: string;
  limit: number;
  json?: boolean;
  markdown?: boolean;
}

export function registerPreferences(program: Command): void {
  addRootOption(
    program
      .command("preferences")
      .description("List personal preferences captured for this repo")
      .option("--topic <t>", "Filter by topic")
      .option("--limit <n>", "Max to show", (v) => parseInt(v, 10), 50)
      .option("--json", "Emit JSON")
      .option("--markdown", "Emit dna-auto-prefs markdown block (for hooks)"),
  ).action(async (opts: Opts) => {
    const root = resolveRoot(opts);
    let prefs = await loadPreferences(root);
    if (opts.topic) prefs = prefs.filter((p) => p.topic === opts.topic);
    prefs = prefs.slice(0, opts.limit);

    if (opts.json) {
      console.log(JSON.stringify({ preferences: prefs }, null, 2));
      return;
    }
    if (prefs.length === 0) {
      if (opts.markdown) return;
      console.log(kleur.dim("no preferences yet — agents auto-capture them, or run `dna prefer \"...\"`"));
      return;
    }
    if (opts.markdown) {
      const lines = ["<!-- dna:auto-prefs -->", "## dna preferences", ""];
      for (const p of prefs) {
        const tag = p.topic ? ` [${p.topic}]` : "";
        lines.push(`- ${p.text}${tag}`);
      }
      lines.push("<!-- /dna:auto-prefs -->");
      console.log(lines.join("\n"));
      return;
    }
    for (const p of prefs) {
      const tag = p.topic ? kleur.cyan(` [${p.topic}]`) : "";
      const src = kleur.dim(`(${p.source}${p.hits ? `, ${p.hits} hits` : ""})`);
      console.log(`  ${p.text}${tag} ${src}`);
    }
  });
}
