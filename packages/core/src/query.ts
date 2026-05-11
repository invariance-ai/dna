import type {
  ContextResult,
  ImpactResult,
  Invariant,
  SymbolRef,
  TestRef,
  Note,
  GetContextInput,
  ImpactInput,
  PrepareEditInput,
  PrepareEditResult,
} from "@invariance/dna-schemas";
import { readIndex, type DnaIndex } from "./index_store.js";
import { loadInvariants, invariantsFor } from "./invariants.js";
import { testsForSymbol } from "./tests.js";
import { logForFile, churn, isGitRepo } from "./git.js";
import { loadNotes, rankNotes } from "./notes.js";

export interface QueryContext {
  root: string;
  index: DnaIndex;
  invariants: Invariant[];
}

export async function open(root: string): Promise<QueryContext> {
  const index = await readIndex(root);
  const invariants = await loadInvariants(root);
  return { root, index, invariants };
}

export function resolveSymbol(query: string, ctx: QueryContext): SymbolRef | null {
  const byId = ctx.index.symbols.find((s) => s.id === query);
  if (byId) return byId;
  const byQualified = ctx.index.symbols.find((s) => s.qualified_name === query);
  if (byQualified) return byQualified;
  const exact = ctx.index.symbols.find((s) => s.name === query);
  if (exact) return exact;
  const q = query.toLowerCase();
  const ci = ctx.index.symbols.find(
    (s) => s.name.toLowerCase() === q || s.qualified_name?.toLowerCase() === q,
  );
  return ci ?? null;
}

export function callersOf(symbol: SymbolRef | string, ctx: QueryContext): SymbolRef[] {
  const sym = typeof symbol === "string" ? resolveSymbol(symbol, ctx) : symbol;
  if (!sym) return [];
  const fromIds = new Set(
    ctx.index.edges
      .filter((e) => e.to_id ? e.to_id === sym.id : e.to === (sym.qualified_name ?? sym.name))
      .map((e) => e.from_id ?? e.from),
  );
  return [...fromIds]
    .map((id) => ctx.index.symbols.find((s) => s.id === id || s.qualified_name === id || s.name === id))
    .filter((s): s is SymbolRef => !!s);
}

export function calleesOf(symbol: SymbolRef | string, ctx: QueryContext): SymbolRef[] {
  const sym = typeof symbol === "string" ? resolveSymbol(symbol, ctx) : symbol;
  if (!sym) return [];
  const toIds = new Set(
    ctx.index.edges
      .filter((e) => e.from_id ? e.from_id === sym.id : e.from === (sym.qualified_name ?? sym.name))
      .map((e) => e.to_id ?? e.to),
  );
  return [...toIds]
    .map((id) => ctx.index.symbols.find((s) => s.id === id || s.qualified_name === id || s.name === id))
    .filter((s): s is SymbolRef => !!s);
}

export async function getContext(
  args: GetContextInput,
  ctxOrRoot: QueryContext | string,
): Promise<ContextResult> {
  const ctx = typeof ctxOrRoot === "string" ? await open(ctxOrRoot) : ctxOrRoot;
  const sym = resolveSymbol(args.symbol, ctx);
  if (!sym) throw new Error(`symbol not found: ${args.symbol}`);

  const wants = new Set(args.strands);
  const callers = wants.has("structural") ? callersOf(sym, ctx) : [];
  const callees = wants.has("structural") ? calleesOf(sym, ctx) : [];
  const tests = wants.has("tests") ? await testsForSymbol(sym.name, sym.file, ctx.root, ctx.index) : [];
  const provenance =
    wants.has("provenance") && (await isGitRepo(ctx.root))
      ? await logForFile(ctx.root, sym.file, 5)
      : [];
  const invariants = wants.has("invariants")
    ? invariantsFor(sym.qualified_name ?? sym.name, ctx.invariants)
    : [];
  const notesAll = await loadNotes(ctx.root, sym.name);
  const notes = rankNotes(notesAll, 5);

  const risk = computeRisk({ callers, tests, invariants, churn: await safeChurn(ctx.root, sym.file) });

  return { symbol: sym, callers, callees, tests, provenance, invariants, notes, risk };
}

export async function impactOf(
  args: ImpactInput,
  ctxOrRoot: QueryContext | string,
): Promise<ImpactResult> {
  const ctx = typeof ctxOrRoot === "string" ? await open(ctxOrRoot) : ctxOrRoot;
  const sym = resolveSymbol(args.symbol, ctx);
  if (!sym) throw new Error(`symbol not found: ${args.symbol}`);

  const visited = new Set<string>();
  const frontier: SymbolRef[] = [sym];
  for (let hop = 0; hop < args.hops; hop++) {
    const next: SymbolRef[] = [];
    for (const current of frontier) {
      const key = current.id ?? current.qualified_name ?? current.name;
      if (visited.has(key)) continue;
      visited.add(key);
      for (const c of callersOf(current, ctx)) next.push(c);
    }
    frontier.length = 0;
    frontier.push(...next);
  }
  visited.delete(sym.id ?? sym.qualified_name ?? sym.name);

  const affected_symbols = [...visited]
    .map((id) => ctx.index.symbols.find((s) => s.id === id || s.qualified_name === id || s.name === id))
    .filter((s): s is SymbolRef => !!s);
  const affected_files = [...new Set(affected_symbols.map((s) => s.file))];
  const affected_tests: TestRef[] = [];
  for (const a of affected_symbols) {
    const ts = await testsForSymbol(a.name, a.file, ctx.root, ctx.index);
    for (const t of ts) if (!affected_tests.find((x) => x.file === t.file)) affected_tests.push(t);
  }

  return {
    symbol: sym,
    affected_symbols,
    affected_files,
    affected_tests,
    blast_radius: affected_symbols.length,
  };
}

export async function prepareEdit(
  args: PrepareEditInput,
  ctxOrRoot: QueryContext | string,
): Promise<PrepareEditResult> {
  const ctx = typeof ctxOrRoot === "string" ? await open(ctxOrRoot) : ctxOrRoot;
  const c = await getContext({ symbol: args.symbol, depth: 2, strands: ["structural", "tests", "provenance", "invariants"] }, ctx);
  const md = formatPrepareEdit(c, args.intent);
  return {
    markdown: md,
    invariants_to_respect: c.invariants,
    notes: c.notes,
    tests_to_run: c.tests.map((t) => t.file),
    risk: c.risk,
  };
}

function computeRisk(p: {
  callers: SymbolRef[];
  tests: TestRef[];
  invariants: Invariant[];
  churn: number;
}): "low" | "medium" | "high" {
  const blocks = p.invariants.some((i) => i.severity === "block");
  const wide = p.callers.length >= 5;
  const untested = p.tests.length === 0 && p.callers.length > 0;
  const hot = p.churn >= 10;
  if (blocks || (wide && untested) || (wide && hot)) return "high";
  if (wide || untested || p.invariants.length > 0) return "medium";
  return "low";
}

async function safeChurn(root: string, file: string): Promise<number> {
  try {
    return await churn(root, file);
  } catch {
    return 0;
  }
}

function formatPrepareEdit(c: ContextResult, intent: string): string {
  const L: string[] = [];
  L.push(`# prepare_edit: ${c.symbol.name}`);
  L.push("");
  L.push(`**Intent:** ${intent}`);
  L.push(`**Defined in:** \`${c.symbol.file}:${c.symbol.line}\` (${c.symbol.kind})`);
  L.push(`**Risk:** ${c.risk.toUpperCase()}`);
  L.push("");
  if (c.callers.length) {
    L.push("## Called by");
    for (const x of c.callers.slice(0, 10)) L.push(`- \`${x.name}\` — ${x.file}:${x.line}`);
    if (c.callers.length > 10) L.push(`- …and ${c.callers.length - 10} more`);
    L.push("");
  }
  if (c.callees.length) {
    L.push("## Calls");
    for (const x of c.callees.slice(0, 10)) L.push(`- \`${x.name}\` — ${x.file}:${x.line}`);
    L.push("");
  }
  if (c.tests.length) {
    L.push("## Tests to run after editing");
    for (const t of c.tests) L.push(`- \`${t.file}\` (${t.framework})`);
    L.push("");
  } else {
    L.push("## Tests");
    L.push("_No tests found — adding a test for this change is recommended._");
    L.push("");
  }
  if (c.invariants.length) {
    L.push("## Invariants that apply");
    for (const inv of c.invariants) {
      L.push(`- **${inv.name}** (${inv.severity}) — ${inv.rule}`);
      if (inv.evidence.length) L.push(`  - evidence: ${inv.evidence.join(", ")}`);
    }
    L.push("");
  }
  if (c.notes.length) {
    L.push("## Notes from previous edits");
    for (const n of c.notes) {
      L.push(`- **[${n.severity}]** ${n.lesson}`);
      if (n.evidence) L.push(`  - evidence: ${n.evidence}`);
    }
    L.push("");
  }
  if (c.provenance.length) {
    L.push("## Recent changes");
    for (const p of c.provenance.slice(0, 5))
      L.push(`- \`${p.commit}\` ${p.date.slice(0, 10)} ${p.author}: ${p.message}`);
    L.push("");
  }
  return L.join("\n");
}
