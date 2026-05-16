import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
import { readIndex } from "./index_store.js";

const execFile = promisify(_execFile);

/**
 * Map a git diff to the symbols whose line ranges overlap with changed hunks.
 *
 * Lower-level than `gate()` — pure structural mapping. Used by the live
 * watch loop and by `dna review-diff` to know *which* symbols were touched
 * (not just which files), so we can filter invariant hits to only those
 * affecting the actual changes.
 */
export interface HunkRange {
  file: string;
  start_line: number;
  end_line: number;
}

export async function changedHunks(root: string, base = "HEAD"): Promise<HunkRange[]> {
  try {
    const { stdout } = await execFile(
      "git",
      ["diff", "--unified=0", base],
      { cwd: root, maxBuffer: 8 * 1024 * 1024 },
    );
    return parseUnifiedDiff(stdout);
  } catch {
    return [];
  }
}

// Accept both standard git diff (`+++ b/path`) and `git diff --no-prefix`
// (`+++ path`) forms. The `b/` prefix is optional; `/dev/null` (deletion of
// the new-side file) is recognised and attributed to no file so deletions
// don't get mis-credited to the previously-seen header.
const FILE_HEADER = /^\+\+\+ (?:b\/)?(.+)$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(diff: string): HunkRange[] {
  const hunks: HunkRange[] = [];
  let currentFile: string | undefined;
  for (const line of diff.split("\n")) {
    const fh = FILE_HEADER.exec(line);
    if (fh) {
      const candidate = fh[1];
      // `/dev/null` on the +++ side means the file was deleted — don't
      // attribute subsequent hunks (there shouldn't be any) to it, and
      // clear any previous file so we don't mis-attribute either.
      currentFile = candidate === "/dev/null" ? undefined : candidate;
      continue;
    }
    const hh = HUNK_HEADER.exec(line);
    if (hh && currentFile) {
      const start = Number(hh[1]);
      const count = hh[2] ? Number(hh[2]) : 1;
      if (count === 0) continue; // deletion-only hunk
      hunks.push({
        file: currentFile,
        start_line: start,
        end_line: start + count - 1,
      });
    }
  }
  return hunks;
}

// TODO(FIX 5): hunk→symbol mapping currently only knows symbol *start*
// lines (see symbolsInHunks heuristic below). Once the parser emits end
// lines we can replace the ±1 fudge with a real range overlap test.

export interface SymbolHit {
  qualified_name: string;
  file: string;
  line: number;
}

/**
 * Return symbols whose declaration line falls inside any of the hunks.
 * Heuristic — we don't track symbol *end* lines yet, so we count a symbol
 * as touched if its starting line is within or just before a hunk window.
 */
export async function symbolsInHunks(
  root: string,
  hunks: HunkRange[],
): Promise<SymbolHit[]> {
  if (hunks.length === 0) return [];
  let index;
  try {
    index = await readIndex(root);
  } catch {
    return [];
  }
  const byFile = new Map<string, HunkRange[]>();
  for (const h of hunks) {
    const arr = byFile.get(h.file) ?? [];
    arr.push(h);
    byFile.set(h.file, arr);
  }
  const out: SymbolHit[] = [];
  for (const sym of index.symbols) {
    const ranges = byFile.get(sym.file);
    if (!ranges) continue;
    for (const r of ranges) {
      // Symbol is "touched" if its declaration line falls in or just above the hunk.
      if (sym.line >= r.start_line - 1 && sym.line <= r.end_line + 1) {
        out.push({
          qualified_name: sym.qualified_name ?? sym.name,
          file: sym.file,
          line: sym.line,
        });
        break;
      }
    }
  }
  return out;
}
