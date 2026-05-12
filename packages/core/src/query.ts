import type {
  ContextResult,
  ImpactResult,
  Invariant,
  SymbolRef,
  TestRef,
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
import { loadDecisions, rankDecisions } from "./decisions.js";
import { loadQuestions, filterByStatus } from "./questions.js";
import { packByBudget, type PackSection } from "./budget.js";
import { parseSince, isAfter } from "./time.js";
import { neighborhood, type NeighborEntry } from "./neighborhood.js";
import { classifyIntent, excludeForIntent } from "./intent.js";
import { loadAssumptions } from "./assumptions.js";
import { gapsForSymbol, type TestGap } from "./testgaps.js";
import type { Assumption } from "@invariance/dna-schemas";
import type { Question, Decision, Note } from "@invariance/dna-schemas";

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
  let provenance =
    wants.has("provenance") && (await isGitRepo(ctx.root))
      ? await logForFile(ctx.root, sym.file, 20)
      : [];
  if (args.since) {
    const since = parseSince(args.since);
    provenance = provenance.filter((p) => isAfter(p.date, since));
  }
  if (args.authored_by) {
    provenance = provenance.filter((p) => p.author === args.authored_by);
  }
  provenance = provenance.slice(0, 5);
  const invariants = wants.has("invariants")
    ? invariantsFor(sym.qualified_name ?? sym.name, ctx.invariants)
    : [];
  const notesAll = await loadNotes(ctx.root, sym.name);
  const decisionsAll = await loadDecisions(ctx.root, sym.name);
  const since = args.since ? parseSince(args.since) : undefined;
  const notesFiltered = since
    ? notesAll.filter((n) => isAfter(n.recorded_at, since))
    : notesAll;
  let decisionsFiltered = since
    ? decisionsAll.filter((d) => isAfter(d.recorded_at, since))
    : decisionsAll;
  if (args.authored_by) {
    decisionsFiltered = decisionsFiltered.filter((d) => d.made_by === args.authored_by);
  }
  const notes = rankNotes(notesFiltered, 5);
  const decisions = rankDecisions(decisionsFiltered, 3);

  const risk = computeRisk({ callers, tests, invariants, churn: await safeChurn(ctx.root, sym.file) });

  return { symbol: sym, callers, callees, tests, provenance, invariants, notes, decisions, risk };
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
  const c = await getContext(
    { symbol: args.symbol, depth: args.depth ?? 2, strands: ["structural", "tests", "provenance", "invariants"] },
    ctx,
  );

  const since = args.since ? parseSince(args.since) : undefined;
  const filteredNotes: Note[] = since ? c.notes.filter((n) => isAfter(n.recorded_at, since)) : c.notes;
  const filteredDecisions: Decision[] = since
    ? c.decisions.filter((d) => isAfter(d.recorded_at, since))
    : c.decisions;

  const symbolKey = c.symbol.qualified_name ?? c.symbol.name;
  const assumptionsAll = await loadAssumptions(ctx.root, symbolKey);
  const unverifiedAssumptions = assumptionsAll.filter((a) => !a.verified);
  const allQuestions = await loadQuestions(ctx.root, symbolKey);
  let unresolved: Question[] = filterByStatus(allQuestions, "unresolved");
  if (since) unresolved = unresolved.filter((q) => isAfter(q.recorded_at, since));

  const filteredContext: ContextResult = {
    ...c,
    notes: filteredNotes,
    decisions: filteredDecisions,
  };

  const depth = args.depth ?? 1;
  const neighbors = depth > 1 ? await neighborhood(ctx, c.symbol, depth) : [];
  const testGaps = await gapsForSymbol(ctx, c.symbol);

  const intentKind = classifyIntent(args.intent);
  const exclude = excludeForIntent(intentKind);

  const md = formatPrepareEdit(filteredContext, args.intent, args.budget, {
    questions: unresolved,
    neighbors,
    exclude,
    assumptions: unverifiedAssumptions,
    testGaps,
  });
  return {
    markdown: md,
    invariants_to_respect: c.invariants,
    notes: filteredNotes,
    decisions: filteredDecisions,
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

export interface FormatPrepareOpts {
  /** Section keys to exclude (e.g. driven by intent classifier). */
  exclude?: Set<string>;
  /** Extra sections (e.g. test gaps, assumptions, neighborhood) to inject. */
  extra?: PackSection[];
  /** Open questions to surface in their own section. */
  questions?: Question[];
  /** Callees with their own knowledge attached. */
  neighbors?: NeighborEntry[];
  /** Unverified assumptions to flag. */
  assumptions?: Assumption[];
  /** Test gaps relative to current edit. */
  testGaps?: TestGap[];
}

function formatPrepareEdit(
  c: ContextResult,
  intent: string,
  budget?: number,
  opts: FormatPrepareOpts = {},
): string {
  const header: string[] = [];
  header.push(`# prepare_edit: ${c.symbol.name}`);
  header.push("");
  header.push(`**Intent:** ${intent}`);
  header.push(`**Defined in:** \`${c.symbol.file}:${c.symbol.line}\` (${c.symbol.kind})`);
  header.push(`**Risk:** ${c.risk.toUpperCase()}`);
  header.push("");

  const sections: PackSection[] = [];
  const add = (key: string, s: PackSection) => {
    if (opts.exclude?.has(key)) return;
    sections.push(s);
  };

  if (opts.assumptions && opts.assumptions.length > 0 && !opts.exclude?.has("assumptions")) {
    sections.push({
      heading: "## Assumptions to verify",
      items: opts.assumptions.map((a) => `- [${a.confidence}] ${a.statement}${a.evidence ? ` _(${a.evidence})_` : ""}`),
    });
  }

  add("invariants", {
    heading: "## Invariants that apply",
    items: c.invariants.map((inv) => {
      const evidence = inv.evidence.length ? `\n  - evidence: ${inv.evidence.join(", ")}` : "";
      return `- **${inv.name}** (${inv.severity}) — ${inv.rule}${evidence}`;
    }),
  });

  add("notes", {
    heading: "## Notes from previous edits",
    items: c.notes.map((n) => {
      const ev = n.evidence ? `\n  - evidence: ${n.evidence}` : "";
      return `- **[${n.severity}]** ${n.lesson}${ev}`;
    }),
  });

  if (opts.questions && opts.questions.length > 0) {
    add("questions", {
      heading: "## Open questions",
      items: opts.questions.map((q) => `- ${q.question}`),
    });
  }

  add("decisions", {
    heading: "## Past decisions",
    items: c.decisions.map((d) => {
      const parts = [`- **${d.decision}**`];
      if (d.rejected_alternative) parts.push(`  - rejected: ${d.rejected_alternative}`);
      if (d.rationale) parts.push(`  - rationale: ${d.rationale}`);
      const meta = [d.made_by && `by ${d.made_by}`, d.session && `from ${d.session}`]
        .filter(Boolean)
        .join(", ");
      if (meta) parts.push(`  - ${meta}`);
      return parts.join("\n");
    }),
  });

  add("callers", {
    heading: "## Called by",
    items: c.callers.slice(0, 10).map((x) => `- \`${x.name}\` — ${x.file}:${x.line}`),
    trailing: c.callers.length > 10 ? `- …and ${c.callers.length - 10} more` : undefined,
  });

  add("callees", {
    heading: "## Calls",
    items: c.callees.slice(0, 10).map((x) => `- \`${x.name}\` — ${x.file}:${x.line}`),
  });

  add("tests", c.tests.length
    ? {
        heading: "## Tests to run after editing",
        items: c.tests.map((t) => `- \`${t.file}\` (${t.framework})`),
      }
    : {
        heading: "## Tests",
        items: [],
        trailing: "_No tests found — adding a test for this change is recommended._",
      });

  add("provenance", {
    heading: "## Recent changes",
    items: c.provenance.slice(0, 5).map(
      (p) => `- \`${p.commit}\` ${p.date.slice(0, 10)} ${p.author}: ${p.message}`,
    ),
  });

  if (opts.testGaps && opts.testGaps.length > 0 && !opts.exclude?.has("testGaps")) {
    sections.push({
      heading: "## Test gaps",
      items: opts.testGaps.map(
        (g) => `- \`${g.callee}\` (${g.reason}) — ${g.file}`,
      ),
    });
  }

  if (opts.neighbors && opts.neighbors.length > 0 && !opts.exclude?.has("neighbors")) {
    const items: string[] = [];
    for (const n of opts.neighbors) {
      const symbolKey = n.symbol.qualified_name ?? n.symbol.name;
      items.push(`- \`${symbolKey}\` (depth ${n.depth})`);
      for (const inv of n.invariants) {
        items.push(`  - invariant: **${inv.name}** — ${inv.rule}`);
      }
      for (const note of n.notes) {
        items.push(`  - note [${note.severity}]: ${note.lesson}`);
      }
    }
    sections.push({ heading: "## Neighborhood context", items });
  }

  if (opts.extra) for (const s of opts.extra) sections.push(s);

  const packed = packByBudget(sections, budget ?? 0);
  let body = packed.text;
  const realBudgetDrops = packed.dropped.filter((d) => d.reason === "budget" && d.items > 0);
  if (budget && realBudgetDrops.length > 0) {
    body += "\n## Trimmed for budget\n";
    for (const d of realBudgetDrops) body += `- ${d.section}: ${d.items} items dropped\n`;
  }
  return header.join("\n") + body;
}
