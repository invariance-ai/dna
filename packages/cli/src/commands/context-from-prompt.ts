import type { Command } from "commander";
import {
  loadNotes,
  loadInvariants,
  invariantsFor,
  readIndex,
  loadFeatures,
  matchFeaturesInPrompt,
} from "@invariance/dna-core";
import type { SymbolRef } from "@invariance/dna-schemas";
import { addRootOption, resolveRoot, type RootOption } from "../root.js";

interface Opts extends RootOption {
  text?: string;
  limit: number;
  minLen: number;
  json?: boolean;
}

const STOPWORDS = new Set([
  "TODO", "FIXME", "NOTE", "XXX", "HACK",
  "README", "CLAUDE", "PR", "MR", "API", "URL", "HTTP", "HTTPS",
  "JSON", "YAML", "TOML", "HTML", "CSS", "SQL",
]);

function extractCandidates(text: string): string[] {
  const out = new Set<string>();
  const add = (tok: string | undefined): void => {
    if (tok) out.add(tok);
  };
  // Backticked spans: `foo.bar` / `createRefund`
  for (const m of text.matchAll(/`([^`\n]{2,80})`/g)) {
    const inner = m[1];
    if (!inner) continue;
    for (const tok of inner.split(/[^A-Za-z0-9_.]+/)) add(tok);
  }
  // PascalCase: Foo, FooBar
  for (const m of text.matchAll(/\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)*)\b/g)) add(m[1]);
  // camelCase with at least one capital: fooBar, createRefund
  for (const m of text.matchAll(/\b([a-z][a-z0-9]+(?:[A-Z][a-z0-9]+)+)\b/g)) add(m[1]);
  // Dotted/namespaced: stripe.refunds.create, foo.bar
  for (const m of text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){1,4})\b/g)) add(m[1]);
  return Array.from(out).filter((t) => !STOPWORDS.has(t));
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function scoreMatch(candidate: string, sym: SymbolRef): number {
  const cand = candidate.toLowerCase();
  const name = sym.name.toLowerCase();
  const qual = sym.qualified_name?.toLowerCase();
  if (qual === cand) return 100;
  if (name === cand) return 95;
  if (qual && qual.endsWith("." + cand)) return 85;
  if (qual?.startsWith(cand)) return 70;
  if (name.startsWith(cand)) return 65;
  return 0;
}

export function registerContextFromPrompt(program: Command): void {
  addRootOption(
    program
      .command("context-from-prompt")
      .description("Extract symbols from prompt text and surface their context (used by UserPromptSubmit hooks)")
      .option("--text <text>", "Prompt text (otherwise read from stdin)")
      .option("--limit <n>", "Max symbols to surface", (v) => parseInt(v, 10), 3)
      .option("--min-len <n>", "Minimum candidate token length", (v) => parseInt(v, 10), 4)
      .option("--json", "Emit JSON instead of markdown"),
  ).action(async (opts: Opts) => {
    const root = resolveRoot(opts);
    const text = (opts.text ?? (await readStdin())).trim();
    if (!text) return;

    let index;
    try {
      index = await readIndex(root);
    } catch {
      // No index yet — silent. Hook must not fail.
      return;
    }

    const candidates = extractCandidates(text).filter((c) => c.length >= opts.minLen);
    if (candidates.length === 0) return;

    const matches = new Map<string, { sym: SymbolRef; score: number }>();

    // Feature-alias matches: if the prompt mentions a known feature label or
    // alias, hydrate the top symbols of that feature with maximum score so
    // they're prioritised alongside explicit symbol mentions.
    try {
      const featuresFile = await loadFeatures(root);
      const hitLabels = matchFeaturesInPrompt(text, featuresFile.features);
      const symbolsById = new Map<string, SymbolRef>();
      for (const sym of index.symbols) if (sym.id) symbolsById.set(sym.id, sym);
      for (const label of hitLabels) {
        const feature = featuresFile.features[label];
        if (!feature) continue;
        for (const fs of feature.symbols.slice(0, opts.limit)) {
          const sym = symbolsById.get(fs.id);
          if (!sym) continue;
          const key = sym.qualified_name ?? sym.name;
          const score = 90 + Math.round(fs.weight * 10);
          const prev = matches.get(key);
          if (!prev || score > prev.score) matches.set(key, { sym, score });
        }
      }
    } catch {
      /* features unavailable — proceed with prompt-extracted candidates only */
    }

    for (const cand of candidates) {
      let best: { sym: SymbolRef; score: number } | null = null;
      for (const sym of index.symbols) {
        const score = scoreMatch(cand, sym);
        if (score >= 85 && (!best || score > best.score)) best = { sym, score };
      }
      if (best) {
        const key = best.sym.qualified_name ?? best.sym.name;
        const prev = matches.get(key);
        if (!prev || best.score > prev.score) matches.set(key, best);
      }
    }
    if (matches.size === 0) return;

    const top = Array.from(matches.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.limit);

    const invariants = await loadInvariants(root);
    const blocks: Array<{
      symbol: string;
      file: string;
      line: number;
      invariants: ReturnType<typeof invariantsFor>;
      notes: Awaited<ReturnType<typeof loadNotes>>;
    }> = [];
    for (const { sym } of top) {
      const symName = sym.qualified_name ?? sym.name;
      const invs = invariantsFor(symName, invariants);
      const notes = await loadNotes(root, symName).catch(() => []);
      if (invs.length === 0 && notes.length === 0) continue;
      blocks.push({ symbol: symName, file: sym.file, line: sym.line, invariants: invs, notes });
    }
    if (blocks.length === 0) return;

    if (opts.json) {
      console.log(JSON.stringify({ matches: blocks }, null, 2));
      return;
    }

    const lines: string[] = [];
    lines.push("<!-- dna:auto-context -->");
    lines.push("## dna auto-loaded context");
    lines.push("");
    lines.push("Symbols mentioned in this prompt have prior context. Respect blocking invariants.");
    lines.push("");
    for (const b of blocks) {
      lines.push(`### ${b.symbol}  \`${b.file}:${b.line}\``);
      if (b.invariants.length > 0) {
        lines.push("");
        lines.push("**Invariants:**");
        for (const inv of b.invariants) {
          const sev = inv.severity ?? "info";
          lines.push(`- [${sev}] ${inv.name}: ${inv.rule}`);
        }
      }
      if (b.notes.length > 0) {
        lines.push("");
        lines.push("**Notes from prior edits:**");
        for (const n of b.notes.slice(0, 5)) {
          const sev = n.severity ?? "info";
          lines.push(`- [${sev}] ${n.lesson}`);
        }
      }
      lines.push("");
    }
    lines.push("<!-- /dna:auto-context -->");
    console.log(lines.join("\n"));
  });
}
