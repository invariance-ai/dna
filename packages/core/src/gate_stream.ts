import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { changedHunks, symbolsInHunks } from "./diff_to_symbols.js";
import { gateIncremental, type GateResult } from "./gate.js";
import { loadConfig, scanFiles } from "./scan.js";

/**
 * Live gate stream: watches the working tree and appends gate findings to
 * .dna/cache/gate-stream.jsonl whenever a touched symbol violates an
 * invariant. The watch is debounced (default 500ms) so a burst of edits
 * collapses to one evaluation.
 *
 * Consumed by:
 *   - `dna gate --watch` (prints findings as they arrive)
 *   - the `gate_stream` MCP tool (tail since timestamp)
 *   - agent hooks (PostToolUse → `dna gate --changed --json`)
 */
const REL = ".dna/cache/gate-stream.jsonl";

export function gateStreamPath(root: string): string {
  return path.join(root, REL);
}

export interface GateStreamEntry {
  ts: string;
  changed_files: string[];
  changed_symbols: string[];
  hits: GateResult["hits"];
  blocking: GateResult["blocking"];
}

export async function readGateStream(
  root: string,
  opts: { since?: string; limit?: number } = {},
): Promise<GateStreamEntry[]> {
  let raw: string;
  try {
    raw = await readFile(gateStreamPath(root), "utf8");
  } catch {
    return [];
  }
  const entries: GateStreamEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as GateStreamEntry);
    } catch {
      // skip malformed
    }
  }
  let out = entries;
  if (opts.since) {
    const cutoff = new Date(opts.since).getTime();
    out = out.filter((e) => new Date(e.ts).getTime() > cutoff);
  }
  if (opts.limit) out = out.slice(-opts.limit);
  return out;
}

export interface WatchOptions {
  /** Milliseconds to wait between bursts before re-evaluating. */
  debounceMs?: number;
  /** Called whenever a new gate evaluation finishes. */
  onEntry?: (entry: GateStreamEntry) => void;
  /** Base ref to diff against (default HEAD). */
  base?: string;
}

export interface WatchHandle {
  stop(): void;
}

/**
 * Watch the source tree (limited to indexed files). Returns a handle the
 * caller can use to stop watching.
 */
export async function watchGateStream(
  root: string,
  opts: WatchOptions = {},
): Promise<WatchHandle> {
  const debounceMs = opts.debounceMs ?? 500;
  const base = opts.base ?? "HEAD";

  const config = await loadConfig(root);
  const files = await scanFiles(root, config);
  const watched = new Set<string>(files);

  let timer: NodeJS.Timeout | undefined;
  let pending = new Set<string>();

  const watchers: ReturnType<typeof watch>[] = [];

  async function evaluate(): Promise<void> {
    const hunks = await changedHunks(root, base);
    if (hunks.length === 0) return;
    const symbols = await symbolsInHunks(root, hunks);
    const result = await gateIncremental(root, {
      touched_files: [...new Set(hunks.map((h) => h.file))],
      touched_symbols: symbols.map((s) => s.qualified_name),
    });
    if (result.hits.length === 0) return;
    const entry: GateStreamEntry = {
      ts: new Date().toISOString(),
      changed_files: result.changed_files,
      changed_symbols: result.changed_symbols,
      hits: result.hits,
      blocking: result.blocking,
    };
    await mkdir(path.dirname(gateStreamPath(root)), { recursive: true });
    await appendFile(gateStreamPath(root), JSON.stringify(entry) + "\n");
    opts.onEntry?.(entry);
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      pending.clear();
      evaluate().catch(() => {
        /* swallow; watchers continue */
      });
    }, debounceMs);
  }

  // One recursive watcher per top-level dir keeps fs.watch happy on darwin.
  const dirsToWatch = new Set<string>();
  for (const f of watched) {
    const rel = path.relative(root, f);
    const top = rel.split(path.sep)[0];
    if (top) dirsToWatch.add(path.join(root, top));
  }
  for (const dir of dirsToWatch) {
    try {
      const w = watch(dir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const abs = path.join(dir, filename);
        if (!watched.has(abs)) return;
        pending.add(abs);
        schedule();
      });
      watchers.push(w);
    } catch {
      // skip unwatchable dirs
    }
  }

  return {
    stop(): void {
      if (timer) clearTimeout(timer);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // ignore
        }
      }
    },
  };
}

/**
 * Snapshot the gate against current dirty diff (no watch loop). Used by
 * `dna gate --changed` and the review-diff tool.
 */
export async function gateChanged(
  root: string,
  opts: { base?: string } = {},
): Promise<GateResult> {
  const hunks = await changedHunks(root, opts.base ?? "HEAD");
  const symbols = await symbolsInHunks(root, hunks);
  return gateIncremental(root, {
    touched_files: [...new Set(hunks.map((h) => h.file))],
    touched_symbols: symbols.map((s) => s.qualified_name),
  });
}

void stat; // keep the import group; stat reserved for future cache invalidation
