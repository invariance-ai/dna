import type { SymbolRef } from "@invariance/dna-schemas";
import { readIndex } from "./index_store.js";
import { loadAllNotes } from "./notes.js";
import { loadAllDecisions } from "./decisions.js";
import { loadInvariants } from "./invariants.js";

/**
 * Walk knowledge entries (notes, decisions, invariants) and flag the ones
 * that have drifted from the source they describe:
 *
 *   missing_anchor   — the symbol the entry points at no longer exists.
 *                      Includes a `suggested_anchor` if a near-match was found.
 *   expired          — entry past its `expires_at` date.
 *   no_anchor_id     — entry has no anchor_id (pre-v0.2 entry, or was authored
 *                      against a symbol that wasn't in the index at the time).
 *
 * Duplicate + contradiction detection are intentionally out of scope for
 * this first pass — they require deeper text analysis and are best authored
 * once anchor health is solid.
 */
export interface KnowledgeIssue {
  kind: "missing_anchor" | "expired" | "no_anchor_id";
  source: "note" | "decision" | "invariant";
  entry: {
    /** Symbol field (legacy / human-readable label). */
    symbol?: string;
    /** Stable id, if present. */
    anchor_id?: string;
    /** Free-text summary of the entry — first 80 chars of the lesson/decision/rule. */
    summary: string;
  };
  /** When kind=missing_anchor, the closest symbol we could find. */
  suggested_anchor?: { symbol_id: string; qualified_name: string; file: string; score: number };
}

export interface ValidateKnowledgeReport {
  total: { notes: number; decisions: number; invariants: number };
  issues: KnowledgeIssue[];
}

export async function validateKnowledge(
  root: string,
): Promise<ValidateKnowledgeReport> {
  let symbols: SymbolRef[] = [];
  try {
    const idx = await readIndex(root);
    symbols = idx.symbols;
  } catch {
    // no index — validator returns "no anchor data" implicitly
  }
  const byName = new Map<string, SymbolRef[]>();
  for (const s of symbols) {
    const arr = byName.get(s.name) ?? [];
    arr.push(s);
    byName.set(s.name, arr);
    const qn = s.qualified_name;
    if (qn && qn !== s.name) {
      const a2 = byName.get(qn) ?? [];
      a2.push(s);
      byName.set(qn, a2);
    }
  }
  const idSet = new Set(symbols.map((s) => s.id).filter(Boolean) as string[]);

  const notes = await loadAllNotes(root);
  const decisions = await loadAllDecisions(root);
  const invariants = await loadInvariants(root);

  const issues: KnowledgeIssue[] = [];
  const now = Date.now();

  for (const n of notes) {
    const summary = (n.lesson ?? "").slice(0, 80);
    if (n.expires_at && new Date(n.expires_at).getTime() < now) {
      issues.push({ kind: "expired", source: "note", entry: { symbol: n.symbol, anchor_id: n.anchor_id, summary } });
      continue;
    }
    if (n.anchor_id && !idSet.has(n.anchor_id)) {
      issues.push({
        kind: "missing_anchor",
        source: "note",
        entry: { symbol: n.symbol, anchor_id: n.anchor_id, summary },
        suggested_anchor: suggestAnchor(n.symbol, byName),
      });
    } else if (!n.anchor_id) {
      // No stable anchor — fall back to name lookup; flag only if name has zero matches.
      if (n.symbol && !byName.has(n.symbol)) {
        issues.push({
          kind: "missing_anchor",
          source: "note",
          entry: { symbol: n.symbol, summary },
          suggested_anchor: suggestAnchor(n.symbol, byName),
        });
      } else if (n.symbol && symbols.length > 0) {
        // entry's anchor is intact but using legacy format
        issues.push({ kind: "no_anchor_id", source: "note", entry: { symbol: n.symbol, summary } });
      }
    }
  }

  for (const d of decisions) {
    const summary = (d.decision ?? "").slice(0, 80);
    if (d.expires_at && new Date(d.expires_at).getTime() < now) {
      issues.push({ kind: "expired", source: "decision", entry: { symbol: d.symbol, anchor_id: d.anchor_id, summary } });
      continue;
    }
    if (d.anchor_id && !idSet.has(d.anchor_id)) {
      issues.push({
        kind: "missing_anchor",
        source: "decision",
        entry: { symbol: d.symbol, anchor_id: d.anchor_id, summary },
        suggested_anchor: suggestAnchor(d.symbol, byName),
      });
    } else if (!d.anchor_id && d.symbol && !byName.has(d.symbol)) {
      issues.push({
        kind: "missing_anchor",
        source: "decision",
        entry: { symbol: d.symbol, summary },
        suggested_anchor: suggestAnchor(d.symbol, byName),
      });
    }
  }

  for (const inv of invariants) {
    const summary = (inv.rule ?? "").slice(0, 80);
    // Invariants use applies_to (multiple) not a single symbol/anchor.
    for (const t of inv.applies_to) {
      if (!t || t.includes("*") || t.includes("/")) continue; // skip globs + file patterns
      if (!byName.has(t)) {
        issues.push({
          kind: "missing_anchor",
          source: "invariant",
          entry: { symbol: t, summary: `[${inv.name}] ${summary}` },
          suggested_anchor: suggestAnchor(t, byName),
        });
      }
    }
  }

  return {
    total: { notes: notes.length, decisions: decisions.length, invariants: invariants.length },
    issues,
  };
}

function suggestAnchor(
  needle: string | undefined,
  byName: Map<string, SymbolRef[]>,
): KnowledgeIssue["suggested_anchor"] {
  if (!needle) return undefined;
  // Cheap fuzzy: case-insensitive substring + length-ratio scoring.
  const needleLow = needle.toLowerCase();
  let best: { sym: SymbolRef; score: number } | undefined;
  for (const [name, syms] of byName) {
    const low = name.toLowerCase();
    let score = 0;
    if (low === needleLow) score = 100;
    else if (low.includes(needleLow) || needleLow.includes(low)) {
      const overlap = Math.min(low.length, needleLow.length);
      const max = Math.max(low.length, needleLow.length);
      score = Math.round((overlap / max) * 80);
    }
    if (score < 40) continue;
    const sym = syms[0]!;
    if (!best || score > best.score) best = { sym, score };
  }
  if (!best || !best.sym.id) return undefined;
  return {
    symbol_id: best.sym.id,
    qualified_name: best.sym.qualified_name ?? best.sym.name,
    file: best.sym.file,
    score: best.score,
  };
}
