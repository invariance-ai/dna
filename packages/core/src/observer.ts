import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Passive observer — opt-in, metadata only.
 *
 * Records *which symbol was queried* and *when*, nothing else. No tool
 * arguments beyond symbol name, no tool results, no conversation content.
 * This is the privacy line: we never persist what an agent asked or what
 * we returned, only that symbol X was looked at N times.
 *
 * Feeds `dna suggest` — symbols with high query counts and no covering
 * invariant become an authoring queue.
 *
 * Storage: .dna/observations.json keyed by symbol name (qualified preferred).
 */
const REL = ".dna/observations.json";

export interface ObservationStore {
  version: 1;
  symbols: Record<
    string,
    {
      count: number;
      last_queried: string;
      tools: Record<string, number>; // count by tool name
    }
  >;
}

const EMPTY: ObservationStore = { version: 1, symbols: {} };

export function observationsPath(root: string): string {
  return path.join(root, REL);
}

async function readStore(root: string): Promise<ObservationStore> {
  try {
    const raw = await readFile(observationsPath(root), "utf8");
    const data = JSON.parse(raw) as ObservationStore;
    if (data?.version === 1 && data.symbols) return data;
    return { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

async function writeStore(root: string, store: ObservationStore): Promise<void> {
  const p = observationsPath(root);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(store, null, 2));
}

export async function recordObservation(
  root: string,
  tool: string,
  symbol: string | undefined,
): Promise<void> {
  if (!symbol) return; // observer is only useful for symbol-scoped calls
  const store = await readStore(root);
  const entry = store.symbols[symbol] ?? {
    count: 0,
    last_queried: new Date(0).toISOString(),
    tools: {},
  };
  entry.count++;
  entry.last_queried = new Date().toISOString();
  entry.tools[tool] = (entry.tools[tool] ?? 0) + 1;
  store.symbols[symbol] = entry;
  await writeStore(root, store);
}

export async function readObservations(root: string): Promise<ObservationStore> {
  return readStore(root);
}

export interface Suggestion {
  symbol: string;
  count: number;
  last_queried: string;
  reason: "no_invariant" | "no_note" | "high_traffic";
}

import { loadInvariants, invariantsFor } from "./invariants.js";
import { loadNotes } from "./notes.js";

/**
 * Authoring queue: symbols agents touch a lot, with no invariant covering them.
 * Heuristic threshold; tune via opts.
 */
export async function suggest(
  root: string,
  opts: { min_count?: number; limit?: number } = {},
): Promise<Suggestion[]> {
  const min = opts.min_count ?? 3;
  const limit = opts.limit ?? 10;
  const store = await readStore(root);
  const invariants = await loadInvariants(root);

  const out: Suggestion[] = [];
  for (const [symbol, entry] of Object.entries(store.symbols)) {
    if (entry.count < min) continue;
    const covered = invariantsFor(symbol, invariants).length > 0;
    if (covered) continue;
    const noteCount = (await loadNotes(root, symbol)).length;
    out.push({
      symbol,
      count: entry.count,
      last_queried: entry.last_queried,
      reason: noteCount === 0 ? "no_note" : "no_invariant",
    });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, limit);
}
