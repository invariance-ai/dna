import { loadAllNotes } from "./notes.js";
import { loadAllQuestions, filterByStatus } from "./questions.js";
import { findPromotionCandidates, type PromotionCandidate } from "./promote.js";
import { findStale, type StaleEntry } from "./stale.js";

export interface ReviewQueue {
  promote: PromotionCandidate[];
  stale: StaleEntry[];
  open_questions: { symbol: string; question: string; age_days: number }[];
  total: number;
}

export async function buildReviewQueue(root: string, opts: { days?: number; limit?: number } = {}): Promise<ReviewQueue> {
  const limit = opts.limit ?? 50;

  const notes = await loadAllNotes(root);
  const symbols = [...new Set(notes.map((n) => n.symbol))];
  const promote: PromotionCandidate[] = [];
  for (const sym of symbols) {
    const c = await findPromotionCandidates(root, sym);
    promote.push(...c);
    if (promote.length >= limit) break;
  }

  const stale = (await findStale(root, { days: opts.days ?? 90 })).slice(0, limit);

  const allQuestions = await loadAllQuestions(root);
  const open = filterByStatus(allQuestions, "unresolved");
  const open_questions = open
    .map((q) => ({
      symbol: q.symbol,
      question: q.question,
      age_days: Math.floor((Date.now() - Date.parse(q.recorded_at)) / 86_400_000),
    }))
    .sort((a, b) => b.age_days - a.age_days)
    .slice(0, limit);

  return {
    promote,
    stale,
    open_questions,
    total: promote.length + stale.length + open_questions.length,
  };
}
