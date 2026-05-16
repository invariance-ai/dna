import { mkdir, readFile } from "node:fs/promises";
import { createWriteStream, openSync, writeSync, closeSync, watch } from "node:fs";
import type { WriteStream } from "node:fs";
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
 *   - the `gate_stream` MCP tool (tail since seq or timestamp)
 *   - agent hooks (PostToolUse → `dna gate --changed --json`)
 *
 * Concurrency note: hooks (one-shot writers) and a long-running `--watch`
 * loop may write to the same JSONL concurrently. We rely on the POSIX
 * guarantee that writes to a file opened O_APPEND that fit within PIPE_BUF
 * (≥512 bytes per POSIX, 4096 on Linux, 512 on macOS) are atomic — so two
 * processes appending small JSON lines won't tear. Each entry must stay
 * under that bound; large hit lists could exceed it. If we ever produce
 * larger entries, switch to an exclusive lockfile or chunked appends.
 */
const REL = ".dna/cache/gate-stream.jsonl";

export function gateStreamPath(root: string): string {
  return path.join(root, REL);
}

export interface GateStreamEntry {
  /** Monotonic per-file counter; preferred cursor for tailing. */
  seq: number;
  ts: string;
  changed_files: string[];
  changed_symbols: string[];
  hits: GateResult["hits"];
  blocking: GateResult["blocking"];
}

export async function readGateStream(
  root: string,
  opts: { since?: string; since_seq?: number; limit?: number } = {},
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
      const parsed = JSON.parse(line) as Partial<GateStreamEntry>;
      // backwards-compat: older entries without `seq` get 0
      if (typeof parsed.seq !== "number") parsed.seq = 0;
      entries.push(parsed as GateStreamEntry);
    } catch {
      // skip malformed
    }
  }
  let out = entries;
  if (typeof opts.since_seq === "number") {
    const cutoff = opts.since_seq;
    out = out.filter((e) => e.seq > cutoff);
  } else if (opts.since) {
    const cutoff = new Date(opts.since).getTime();
    out = out.filter((e) => new Date(e.ts).getTime() > cutoff);
  }
  if (opts.limit) out = out.slice(-opts.limit);
  return out;
}

/**
 * Read the maximum `seq` value currently persisted. Used by watchers to
 * resume numbering after a restart so cursors remain monotonic.
 */
async function readMaxSeq(root: string): Promise<number> {
  const entries = await readGateStream(root);
  let max = 0;
  for (const e of entries) if (e.seq > max) max = e.seq;
  return max;
}

/**
 * Append a single entry using a short-lived O_APPEND fd. Used by one-shot
 * callers (hooks, `dna gate --changed`) where the cost of opening a fd is
 * dwarfed by the gate evaluation itself. See concurrency note above.
 */
export async function appendGateStreamEntry(
  root: string,
  entry: Omit<GateStreamEntry, "seq"> & { seq?: number },
): Promise<GateStreamEntry> {
  const p = gateStreamPath(root);
  await mkdir(path.dirname(p), { recursive: true });
  const seq = entry.seq ?? (await readMaxSeq(root)) + 1;
  const full: GateStreamEntry = { ...entry, seq };
  const line = JSON.stringify(full) + "\n";
  // openSync/writeSync/closeSync — O_APPEND atomic for writes < PIPE_BUF.
  const fd = openSync(p, "a");
  try {
    writeSync(fd, line);
  } finally {
    closeSync(fd);
  }
  return full;
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

  // Linux's fs.watch does not implement { recursive: true }. We still
  // register the watchers below (some kernels/libuv builds do support it
  // for top-level only), but warn the user so they aren't surprised when
  // edits in nested directories don't trigger a re-evaluation. Polling
  // alternatives (chokidar) would be a follow-up; we deliberately don't
  // add new deps in this PR.
  if (process.platform === "linux") {
    // eslint-disable-next-line no-console
    console.warn(
      "[dna gate --watch] Recursive fs.watch is not supported on Linux. " +
        "Changes inside nested directories may not trigger re-evaluation. " +
        "Run `dna gate --watch` from each package root, or rely on the " +
        "PostToolUse hook (`dna gate --changed`) for full coverage.",
    );
  }

  // Long-lived O_APPEND stream — see concurrency note at top of file.
  // Reusing one stream avoids the per-entry open/close cost while keeping
  // writes atomic for entries that fit within PIPE_BUF.
  await mkdir(path.dirname(gateStreamPath(root)), { recursive: true });
  const stream: WriteStream = createWriteStream(gateStreamPath(root), {
    flags: "a",
  });

  let seqCounter = await readMaxSeq(root);

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
    seqCounter += 1;
    const entry: GateStreamEntry = {
      seq: seqCounter,
      ts: new Date().toISOString(),
      changed_files: result.changed_files,
      changed_symbols: result.changed_symbols,
      hits: result.hits,
      blocking: result.blocking,
    };
    stream.write(JSON.stringify(entry) + "\n");
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
      try {
        stream.end();
      } catch {
        // ignore
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
