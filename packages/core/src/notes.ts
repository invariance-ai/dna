import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  Note,
  type NoteSeverity,
  type NoteSource,
  type Note as NoteT,
} from "@invariance/dna-schemas";

const DIR = ".dna/notes";

function fileFor(root: string, symbol: string): string {
  // Symbols can contain `.` (Stripe.refunds.create) or `/` (path/to/sym).
  // Sanitize for filenames.
  const safe = symbol.replace(/[/\\:]/g, "__").replace(/\./g, "_");
  return path.join(root, DIR, `${safe}.yml`);
}

export async function loadNotes(root: string, symbol: string): Promise<NoteT[]> {
  try {
    const raw = await readFile(fileFor(root, symbol), "utf8");
    const data = parseYaml(raw);
    if (!Array.isArray(data)) return [];
    return data.map((d: unknown) => Note.parse(d));
  } catch {
    return [];
  }
}

export interface AppendOpts {
  symbol: string;
  lesson: string;
  evidence?: string;
  severity?: NoteSeverity;
  source?: NoteSource;
}

export async function appendNote(
  root: string,
  opts: AppendOpts,
): Promise<{ note: NoteT; file: string }> {
  const note: NoteT = Note.parse({
    symbol: opts.symbol,
    lesson: opts.lesson,
    evidence: opts.evidence,
    severity: opts.severity ?? "medium",
    promoted: false,
    recorded_at: new Date().toISOString(),
    source: opts.source ?? "human",
  });
  const file = fileFor(root, opts.symbol);
  await mkdir(path.dirname(file), { recursive: true });
  const existing = await loadNotes(root, opts.symbol);
  const next = [...existing, note];
  await writeFile(file, stringifyYaml(next));
  return { note, file: path.relative(root, file) };
}

const SEV_RANK: Record<NoteSeverity, number> = { high: 0, medium: 1, low: 2 };

export function rankNotes(notes: NoteT[], limit = 5, includePromoted = false): NoteT[] {
  return notes
    .filter((n) => includePromoted || !n.promoted)
    .sort((a, b) => {
      const s = SEV_RANK[a.severity] - SEV_RANK[b.severity];
      if (s !== 0) return s;
      return b.recorded_at.localeCompare(a.recorded_at);
    })
    .slice(0, limit);
}

export async function loadAllNotes(root: string): Promise<NoteT[]> {
  try {
    const files = await readdir(path.join(root, DIR));
    const out: NoteT[] = [];
    for (const f of files) {
      if (!f.endsWith(".yml")) continue;
      const raw = await readFile(path.join(root, DIR, f), "utf8");
      const data = parseYaml(raw);
      if (Array.isArray(data)) {
        for (const d of data) {
          try {
            out.push(Note.parse(d));
          } catch {
            /* skip malformed */
          }
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Scan repo files for `TODO(symbol):` and `FIXME(symbol):` markers and lift
 * them into notes. One-shot day-zero corpus from comments your code already
 * carries. Re-running is idempotent: lessons collide on (symbol, lesson, source)
 * and dedupe.
 */
const TODO_RE = /(?:TODO|FIXME|XXX)\(([A-Za-z_$][\w$.]*)\)\s*:?\s*(.+)$/gm;

export interface TodoExtraction {
  symbol: string;
  lesson: string;
  evidence: string;
}

export function extractTodos(src: string, file: string): TodoExtraction[] {
  const out: TodoExtraction[] = [];
  for (const m of src.matchAll(TODO_RE)) {
    const symbol = m[1];
    const lesson = m[2]?.trim();
    if (!symbol || !lesson) continue;
    const line = src.slice(0, m.index).split("\n").length;
    out.push({ symbol, lesson, evidence: `${file}:${line}` });
  }
  return out;
}
