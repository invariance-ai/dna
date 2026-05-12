import { loadAllNotes } from "./notes.js";
import { loadAllDecisions } from "./decisions.js";
import { loadAllQuestions, filterByStatus } from "./questions.js";
import { loadFeatures } from "./features.js";
import { readIndex } from "./index_store.js";
import { logForFile, isGitRepo } from "./git.js";
import { daysBetween } from "./time.js";

export type StaleKind = "note" | "decision" | "question";

export interface StaleEntry {
  kind: StaleKind;
  symbol: string;
  age_days: number;
  file?: string;
  /** True when the underlying source file has commits newer than the entry. */
  file_changed_since: boolean;
  text: string;
}

export interface StaleOpts {
  days?: number;
  feature?: string;
}

/**
 * Surface notes/decisions/open questions that are older than `days` and whose
 * symbol's file has been touched since they were recorded — i.e. the code
 * moved but the knowledge didn't. When `feature` is set, restrict to symbols
 * in that feature's bag.
 */
export async function findStale(root: string, opts: StaleOpts = {}): Promise<StaleEntry[]> {
  const days = opts.days ?? 90;
  const cutoff = new Date(Date.now() - days * 86_400_000);

  let symbolFilter: Set<string> | undefined;
  if (opts.feature) {
    const features = await loadFeatures(root);
    const f = features.features[opts.feature];
    if (!f) return [];
    symbolFilter = new Set(f.symbols.map((s) => s.id));
  }

  let index: Awaited<ReturnType<typeof readIndex>> | undefined;
  try {
    index = await readIndex(root);
  } catch {
    /* no index — proceed without file lookup */
  }

  const fileBySymbol = new Map<string, string>();
  if (index) {
    for (const s of index.symbols) {
      const keys = [s.id, s.qualified_name, s.name].filter((k): k is string => !!k);
      for (const k of keys) if (!fileBySymbol.has(k)) fileBySymbol.set(k, s.file);
      if (symbolFilter && s.id && symbolFilter.has(s.id)) {
        for (const k of keys) symbolFilter.add(k);
      }
    }
  }

  const gitOk = await isGitRepo(root);
  const fileChangeCache = new Map<string, boolean>();
  const fileChanged = async (file: string, sinceISO: string): Promise<boolean> => {
    if (!gitOk) return false;
    const key = `${file}@${sinceISO}`;
    const cached = fileChangeCache.get(key);
    if (cached !== undefined) return cached;
    try {
      const log = await logForFile(root, file, 10);
      const result = log.some((e) => Date.parse(e.date) > Date.parse(sinceISO));
      fileChangeCache.set(key, result);
      return result;
    } catch {
      fileChangeCache.set(key, false);
      return false;
    }
  };

  const out: StaleEntry[] = [];

  const [notes, decisions, questions] = await Promise.all([
    loadAllNotes(root),
    loadAllDecisions(root),
    loadAllQuestions(root),
  ]);

  for (const n of notes) {
    if (Date.parse(n.recorded_at) > cutoff.getTime()) continue;
    if (symbolFilter && !symbolFilter.has(n.symbol)) continue;
    const file = fileBySymbol.get(n.symbol);
    const file_changed_since = file ? await fileChanged(file, n.recorded_at) : false;
    out.push({
      kind: "note",
      symbol: n.symbol,
      age_days: daysBetween(n.recorded_at),
      file,
      file_changed_since,
      text: n.lesson,
    });
  }

  for (const d of decisions) {
    if (Date.parse(d.recorded_at) > cutoff.getTime()) continue;
    if (symbolFilter && !symbolFilter.has(d.symbol)) continue;
    const file = fileBySymbol.get(d.symbol);
    const file_changed_since = file ? await fileChanged(file, d.recorded_at) : false;
    out.push({
      kind: "decision",
      symbol: d.symbol,
      age_days: daysBetween(d.recorded_at),
      file,
      file_changed_since,
      text: d.decision,
    });
  }

  for (const q of filterByStatus(questions, "unresolved")) {
    if (Date.parse(q.recorded_at) > cutoff.getTime()) continue;
    if (symbolFilter && !symbolFilter.has(q.symbol)) continue;
    const file = fileBySymbol.get(q.symbol);
    const file_changed_since = file ? await fileChanged(file, q.recorded_at) : false;
    out.push({
      kind: "question",
      symbol: q.symbol,
      age_days: daysBetween(q.recorded_at),
      file,
      file_changed_since,
      text: q.question,
    });
  }

  out.sort((a, b) => {
    if (a.file_changed_since !== b.file_changed_since) return a.file_changed_since ? -1 : 1;
    return b.age_days - a.age_days;
  });
  return out;
}
