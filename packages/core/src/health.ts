import { loadAllNotes } from "./notes.js";
import { loadAllDecisions } from "./decisions.js";
import { loadAllQuestions, filterByStatus } from "./questions.js";
import { loadAllAssumptions } from "./assumptions.js";
import { loadFeatures } from "./features.js";
import { loadInvariants, invariantsFor } from "./invariants.js";
import { findConflicts } from "./conflicts.js";
import { daysBetween } from "./time.js";

export interface FeatureHealth {
  feature: string;
  symbols: number;
  invariants: number;
  notes: number;
  notes_stale: number;
  decisions: number;
  open_questions: number;
  open_questions_old: number;
  assumptions: number;
  unverified_assumptions: number;
  conflicts: number;
  score: number;
  last_active: string;
}

const STALE_NOTE_DAYS = 180;
const OLD_QUESTION_DAYS = 30;

/**
 * Aggregate knowledge-layer signals for one feature. Score is a weighted blend
 * of normalized sub-scores (each clamped 0..1). Higher = healthier.
 *
 * Sub-scores:
 *   coverage      = min(1, invariants / 4)              (target: 4 invariants)
 *   freshness     = 1 - notes_stale / max(notes, 1)
 *   question_load = 1 - old_questions / max(open, 1)
 *   assumption    = 1 - unverified / max(total, 1)
 *   conflict      = exp(-conflicts / 3)
 *   decisions     = min(1, decisions / 6)
 */
export async function featureHealth(root: string, label: string): Promise<FeatureHealth | undefined> {
  const features = await loadFeatures(root);
  const f = features.features[label];
  if (!f) return undefined;

  const symbolIds = new Set(f.symbols.map((s) => s.id));
  // We also accept "name only" keys when YAML files were saved by name.
  const allInvariants = await loadInvariants(root);
  const allNotes = await loadAllNotes(root);
  const allDecisions = await loadAllDecisions(root);
  const allQuestions = await loadAllQuestions(root);
  const allAssumptions = await loadAllAssumptions(root);

  const inScope = (sym: string): boolean => {
    if (symbolIds.has(sym)) return true;
    for (const id of symbolIds) {
      if (id.endsWith(`#${sym}`) || id.endsWith(`#${sym}:`)) return true;
      if (id.includes(`#${sym}:`)) return true;
    }
    return false;
  };

  const notes = allNotes.filter((n) => inScope(n.symbol));
  const decisions = allDecisions.filter((d) => inScope(d.symbol));
  const open = filterByStatus(allQuestions, "unresolved").filter((q) => inScope(q.symbol));
  const assumptions = allAssumptions.filter((a) => inScope(a.symbol));

  const invariantSymbols = new Set<string>();
  for (const inv of allInvariants) {
    for (const pat of inv.applies_to) {
      for (const id of symbolIds) {
        const sym = id.split("#").pop()?.split(":")[0] ?? id;
        if (invariantsFor(sym, [inv]).length > 0) invariantSymbols.add(inv.name);
      }
    }
  }
  const invariantCount = invariantSymbols.size;

  const notes_stale = notes.filter((n) => daysBetween(n.recorded_at) > STALE_NOTE_DAYS).length;
  const open_questions_old = open.filter((q) => daysBetween(q.recorded_at) > OLD_QUESTION_DAYS).length;
  const unverified = assumptions.filter((a) => !a.verified).length;

  // Conflict count: heuristic only, deduped across symbols in scope.
  let conflicts = 0;
  const sampled = new Set<string>();
  for (const id of symbolIds) {
    const sym = id.split("#").pop()?.split(":")[0] ?? id;
    if (sampled.has(sym)) continue;
    sampled.add(sym);
    const c = await findConflicts(root, sym);
    conflicts += c.length;
    if (sampled.size > 20) break; // cap for speed
  }

  const coverage = Math.min(1, invariantCount / 4);
  const freshness = notes.length > 0 ? 1 - notes_stale / notes.length : 1;
  const question_load = open.length > 0 ? 1 - open_questions_old / open.length : 1;
  const assumption_score = assumptions.length > 0 ? 1 - unverified / assumptions.length : 1;
  const conflict_score = Math.exp(-conflicts / 3);
  const decisions_score = Math.min(1, decisions.length / 6);

  const score =
    0.25 * coverage +
    0.15 * freshness +
    0.15 * question_load +
    0.15 * assumption_score +
    0.15 * conflict_score +
    0.15 * decisions_score;

  return {
    feature: label,
    symbols: f.symbols.length,
    invariants: invariantCount,
    notes: notes.length,
    notes_stale,
    decisions: decisions.length,
    open_questions: open.length,
    open_questions_old,
    assumptions: assumptions.length,
    unverified_assumptions: unverified,
    conflicts,
    score,
    last_active: f.last_active,
  };
}

export async function allFeatureHealth(root: string): Promise<FeatureHealth[]> {
  const features = await loadFeatures(root);
  const out: FeatureHealth[] = [];
  for (const label of Object.keys(features.features)) {
    const h = await featureHealth(root, label);
    if (h) out.push(h);
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}
