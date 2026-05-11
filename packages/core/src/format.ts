import type {
  ContextResult,
  ImpactResult,
  Invariant,
  TestRef,
  ProvenanceEntry,
} from "@invariance/dna-schemas";

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

const riskColor: Record<string, (s: string) => string> = {
  high: c.red,
  medium: c.yellow,
  low: c.green,
};

export function formatContextPretty(r: ContextResult): string {
  const L: string[] = [];
  L.push(c.bold(`Symbol:    ${r.symbol.name}`) + c.dim(`  (${r.symbol.kind})`));
  L.push(`Defined in: ${r.symbol.file}:${r.symbol.line}`);
  L.push(`Risk:      ${riskColor[r.risk]!(r.risk.toUpperCase())}`);
  L.push("");
  if (r.callers.length) {
    L.push(c.bold("Called by:"));
    for (const x of r.callers.slice(0, 10)) L.push(`  - ${x.name}  ${c.dim(`${x.file}:${x.line}`)}`);
    if (r.callers.length > 10) L.push(c.dim(`  …and ${r.callers.length - 10} more`));
    L.push("");
  }
  if (r.callees.length) {
    L.push(c.bold("Calls:"));
    for (const x of r.callees.slice(0, 10)) L.push(`  - ${x.name}  ${c.dim(`${x.file}:${x.line}`)}`);
    L.push("");
  }
  if (r.tests.length) {
    L.push(c.bold("Tests:"));
    for (const t of r.tests) L.push(`  - ${t.file}  ${c.dim(`(${t.framework})`)}`);
    L.push("");
  }
  if (r.invariants.length) {
    L.push(c.bold("Invariants:"));
    for (const inv of r.invariants) {
      L.push(`  - ${c.cyan(inv.name)} ${c.dim(`[${inv.severity}]`)}`);
      L.push(`    ${inv.rule}`);
      if (inv.evidence.length) L.push(c.dim(`    evidence: ${inv.evidence.join(", ")}`));
    }
    L.push("");
  }
  if (r.provenance.length) {
    L.push(c.bold("Recent changes:"));
    for (const p of r.provenance.slice(0, 5))
      L.push(`  - ${c.dim(p.commit)} ${p.date.slice(0, 10)} ${p.author}: ${p.message}`);
    L.push("");
  }
  return L.join("\n");
}

export function formatImpactPretty(r: ImpactResult): string {
  const L: string[] = [];
  L.push(c.bold(`Impact of ${r.symbol.name}`) + c.dim(`  (blast radius: ${r.blast_radius})`));
  L.push("");
  if (r.affected_symbols.length) {
    L.push(c.bold("Affected symbols:"));
    for (const s of r.affected_symbols) L.push(`  - ${s.name}  ${c.dim(`${s.file}:${s.line}`)}`);
    L.push("");
  }
  if (r.affected_files.length) {
    L.push(c.bold("Affected files:"));
    for (const f of r.affected_files) L.push(`  - ${f}`);
    L.push("");
  }
  if (r.affected_tests.length) {
    L.push(c.bold("Tests to run:"));
    for (const t of r.affected_tests) L.push(`  - ${t.file}  ${c.dim(`(${t.framework})`)}`);
    L.push("");
  }
  return L.join("\n");
}

export function formatInvariantsPretty(symbol: string, invs: Invariant[]): string {
  if (invs.length === 0) return c.dim(`No invariants apply to ${symbol}.`);
  const L: string[] = [c.bold(`Invariants for ${symbol}:`), ""];
  for (const inv of invs) {
    L.push(`  - ${c.cyan(inv.name)} ${c.dim(`[${inv.severity}]`)}`);
    L.push(`    ${inv.rule}`);
    if (inv.evidence.length) L.push(c.dim(`    evidence: ${inv.evidence.join(", ")}`));
  }
  return L.join("\n");
}

export function formatTestsPretty(symbol: string, tests: TestRef[]): string {
  if (tests.length === 0) return c.dim(`No tests found for ${symbol}.`);
  const L: string[] = [c.bold(`Tests for ${symbol}:`), ""];
  for (const t of tests) L.push(`  - ${t.file}  ${c.dim(`(${t.framework})`)}`);
  return L.join("\n");
}

export function formatTracePretty(symbol: string, p: ProvenanceEntry[]): string {
  if (p.length === 0) return c.dim(`No git history for ${symbol}.`);
  const L: string[] = [c.bold(`History for ${symbol}:`), ""];
  for (const e of p) L.push(`  ${c.dim(e.commit)} ${e.date.slice(0, 10)} ${e.author}: ${e.message}`);
  return L.join("\n");
}
