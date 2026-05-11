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
import { testsForSymbol, testFilesIn, frameworkFor } from "./tests.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { logForFile, churn, isGitRepo } from "./git.js";
import { loadNotes, rankNotes } from "./notes.js";
import { loadDecisions, rankDecisions } from "./decisions.js";
import { loadPreferences, rankPreferences } from "./preferences.js";

interface IndexLookups {
  byId: Map<string, SymbolRef>;
  byQualified: Map<string, SymbolRef>;
  byName: Map<string, SymbolRef[]>;
  byNameLower: Map<string, SymbolRef>;
  callers: Map<string, string[]>; // sym key -> from keys
  callees: Map<string, string[]>; // sym key -> to keys
}

export interface QueryContext {
  root: string;
  index: DnaIndex;
  invariants: Invariant[];
  _lookups?: IndexLookups;
}

function symKey(s: SymbolRef): string {
  return s.id ?? s.qualified_name ?? s.name;
}

function buildLookups(index: DnaIndex): IndexLookups {
  const byId = new Map<string, SymbolRef>();
  const byQualified = new Map<string, SymbolRef>();
  const byName = new Map<string, SymbolRef[]>();
  const byNameLower = new Map<string, SymbolRef>();
  for (const s of index.symbols) {
    if (s.id) byId.set(s.id, s);
    if (s.qualified_name && !byQualified.has(s.qualified_name)) byQualified.set(s.qualified_name, s);
    const list = byName.get(s.name);
    if (list) list.push(s);
    else byName.set(s.name, [s]);
    const lower = s.name.toLowerCase();
    if (!byNameLower.has(lower)) byNameLower.set(lower, s);
    if (s.qualified_name) {
      const qlower = s.qualified_name.toLowerCase();
      if (!byNameLower.has(qlower)) byNameLower.set(qlower, s);
    }
  }
  const callers = new Map<string, string[]>();
  const callees = new Map<string, string[]>();
  for (const e of index.edges) {
    const from = e.from_id ?? e.from;
    const to = e.to_id ?? e.to;
    const list1 = callers.get(to);
    if (list1) list1.push(from);
    else callers.set(to, [from]);
    const list2 = callees.get(from);
    if (list2) list2.push(to);
    else callees.set(from, [to]);
  }
  return { byId, byQualified, byName, byNameLower, callers, callees };
}

function lookups(ctx: QueryContext): IndexLookups {
  if (!ctx._lookups) ctx._lookups = buildLookups(ctx.index);
  return ctx._lookups;
}

export async function open(root: string): Promise<QueryContext> {
  const index = await readIndex(root);
  const invariants = await loadInvariants(root);
  return { root, index, invariants };
}

export function resolveSymbol(query: string, ctx: QueryContext): SymbolRef | null {
  const L = lookups(ctx);
  const byId = L.byId.get(query);
  if (byId) return byId;
  const byQualified = L.byQualified.get(query);
  if (byQualified) return byQualified;
  const byNameList = L.byName.get(query);
  const first = byNameList?.[0];
  if (first) return first;
  return L.byNameLower.get(query.toLowerCase()) ?? null;
}

function resolveByKey(key: string, L: IndexLookups): SymbolRef | undefined {
  return L.byId.get(key) ?? L.byQualified.get(key) ?? L.byName.get(key)?.[0];
}

export function callersOf(symbol: SymbolRef | string, ctx: QueryContext): SymbolRef[] {
  const L = lookups(ctx);
  const sym = typeof symbol === "string" ? resolveSymbol(symbol, ctx) : symbol;
  if (!sym) return [];
  const keys: string[] = [];
  if (sym.id) keys.push(sym.id);
  const qn = sym.qualified_name ?? sym.name;
  if (qn !== sym.id) keys.push(qn);
  const seen = new Set<string>();
  const out: SymbolRef[] = [];
  for (const key of keys) {
    const list = L.callers.get(key);
    if (!list) continue;
    for (const k of list) {
      if (seen.has(k)) continue;
      seen.add(k);
      const r = resolveByKey(k, L);
      if (r) out.push(r);
    }
  }
  return out;
}

export function calleesOf(symbol: SymbolRef | string, ctx: QueryContext): SymbolRef[] {
  const L = lookups(ctx);
  const sym = typeof symbol === "string" ? resolveSymbol(symbol, ctx) : symbol;
  if (!sym) return [];
  const keys: string[] = [];
  if (sym.id) keys.push(sym.id);
  const qn = sym.qualified_name ?? sym.name;
  if (qn !== sym.id) keys.push(qn);
  const seen = new Set<string>();
  const out: SymbolRef[] = [];
  for (const key of keys) {
    const list = L.callees.get(key);
    if (!list) continue;
    for (const k of list) {
      if (seen.has(k)) continue;
      seen.add(k);
      const r = resolveByKey(k, L);
      if (r) out.push(r);
    }
  }
  return out;
}

export async function getContext(
  args: GetContextInput,
  ctxOrRoot: QueryContext | string,
): Promise<ContextResult> {
  const ctx = typeof ctxOrRoot === "string" ? await open(ctxOrRoot) : ctxOrRoot;
  const sym = resolveSymbol(args.symbol, ctx);
  if (!sym) throw new Error(`symbol not found: ${args.symbol}`);

  const wants = new Set(args.strands);
  const MAX_NEIGHBORS = 25;
  const callers = wants.has("structural") ? callersOf(sym, ctx).slice(0, MAX_NEIGHBORS) : [];
  const callees = wants.has("structural") ? calleesOf(sym, ctx).slice(0, MAX_NEIGHBORS) : [];
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
  const decisionsAll = await loadDecisions(ctx.root, sym.name);
  const decisions = rankDecisions(decisionsAll, 3);
  const prefsAll = await loadPreferences(ctx.root);
  const preferences = rankPreferences(prefsAll, sym.name, sym.file, 5);

  const risk = computeRisk({ callers, tests, invariants, churn: await safeChurn(ctx.root, sym.file) });

  return { symbol: sym, callers, callees, tests, provenance, invariants, notes, decisions, preferences, risk };
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
      visited.add(key);
      for (const c of callersOf(current, ctx)) {
        const callerKey = c.id ?? c.qualified_name ?? c.name;
        if (!visited.has(callerKey)) {
          visited.add(callerKey);
          next.push(c);
        }
      }
    }
    frontier.length = 0;
    frontier.push(...next);
  }
  visited.delete(sym.id ?? sym.qualified_name ?? sym.name);

  const L = lookups(ctx);
  const affected_symbols = [...visited]
    .map((id) => resolveByKey(id, L))
    .filter((s): s is SymbolRef => !!s);
  const affected_files = [...new Set(affected_symbols.map((s) => s.file))];

  // Batch test discovery: read each test file at most once, scan once for any
  // of the affected symbol names. Cuts O(N_symbols × F_tests) to O(F_tests).
  const names = new Set(affected_symbols.map((a) => a.name).filter((n) => n.length > 2));
  const candidates = testFilesIn(ctx.index);
  const affected_tests: TestRef[] = [];
  await Promise.all(
    candidates.map(async (t) => {
      try {
        const src = await readFile(path.join(ctx.root, t), "utf8");
        for (const n of names) {
          if (src.includes(n)) {
            affected_tests.push({ file: t, framework: frameworkFor(t), symbols_covered: [n] });
            return;
          }
        }
      } catch {
        // ignore
      }
    }),
  );

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
    decisions: c.decisions,
    preferences: c.preferences,
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
  if (c.preferences.length) {
    L.push("## User preferences that apply");
    for (const p of c.preferences) {
      L.push(`- ${p.text}`);
      if (p.evidence) L.push(`  - evidence: ${p.evidence}`);
    }
    L.push("");
  }
  if (c.decisions.length) {
    L.push("## Past decisions");
    for (const d of c.decisions) {
      L.push(`- **${d.decision}**`);
      if (d.rejected_alternative) L.push(`  - rejected: ${d.rejected_alternative}`);
      if (d.rationale) L.push(`  - rationale: ${d.rationale}`);
      const meta = [d.made_by && `by ${d.made_by}`, d.session && `from ${d.session}`].filter(Boolean).join(", ");
      if (meta) L.push(`  - ${meta}`);
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
