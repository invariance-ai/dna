import path from "node:path";
import { createHash } from "node:crypto";
import type {
  NoteScope,
  NoteSeverity,
  ClassifierMeta,
  LessonEntry,
} from "@invariance/dna-schemas";
import { readIndex, type DnaIndex } from "./index_store.js";
import {
  loadFeatures,
  matchFeaturesInPrompt,
} from "./features.js";
import {
  appendNote,
  appendFileNote,
  appendFeatureNote,
  loadAllNotes,
  loadAllFileNotes,
  loadAllFeatureNotes,
  removeNoteById,
} from "./notes.js";
import {
  upsertGlobalLesson,
  removeGlobalLesson,
  readGlobalLessons,
  generateLessonId,
} from "./claude_md.js";

/* ----------------------- heuristic scoring ----------------------- */

const GENERIC_QUANTIFIERS =
  /\b(always|never|every|any|all|the codebase|this repo|in general|whenever|repo-wide|globally|throughout)\b/gi;

const POLICY_VERBS =
  /\b(prefer|avoid|don'?t|do not|should|must|never)\b/gi;

/** Dotted/qualified identifier like `foo.bar.baz`. */
const QUALIFIED_NAME_RE =
  /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){1,4}\b/g;

/** PascalCase + camelCase + dotted, conservative — must include a letter+digit/Caps mix. */
const SYMBOLLIKE_RE =
  /\b(?:[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+|[a-z][a-z0-9]+(?:[A-Z][a-z0-9]+)+|[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)\b/g;

const FILEPATH_RE =
  /\b(?:[\w@.-]+\/)*[\w@.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|rb|java|kt|swift|md|yml|yaml|toml|json)\b/g;

const BACKTICK_RE = /`([^`\n]{1,80})`/g;

export interface ClassifyContext {
  index?: DnaIndex;
  features?: Awaited<ReturnType<typeof loadFeatures>>;
}

export interface ClassifyResult {
  scope: NoteScope;
  target?: string;
  confidence: number;
  signals: string[];
  candidates: {
    symbols: string[];
    files: string[];
    features: string[];
  };
  ambiguous: boolean;
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

function extractSymbols(text: string, index?: DnaIndex): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(SYMBOLLIKE_RE)) out.push(m[0]);
  for (const m of text.matchAll(QUALIFIED_NAME_RE)) out.push(m[0]);
  for (const m of text.matchAll(BACKTICK_RE)) {
    const inner = m[1];
    if (!inner) continue;
    for (const tok of inner.split(/[^A-Za-z0-9_.$]+/)) {
      if (tok.length >= 3) out.push(tok);
    }
  }
  const all = dedupe(out);
  if (!index) return all;
  // Validate against index: keep only candidates that resolve to known symbols.
  const known = new Set<string>();
  for (const s of index.symbols) {
    known.add(s.name);
    if (s.qualified_name) known.add(s.qualified_name);
  }
  return all.filter((c) => known.has(c) || known.has(c.split(".").pop() ?? ""));
}

function extractFiles(text: string, index?: DnaIndex): string[] {
  const matches: string[] = [];
  for (const m of text.matchAll(FILEPATH_RE)) matches.push(m[0]);
  const all = dedupe(matches);
  if (!index) return all;
  const known = new Set(index.files);
  return all.filter((f) => known.has(f) || index.files.some((idxF) => idxF.endsWith("/" + f)));
}

function extractFeatures(
  text: string,
  features?: Awaited<ReturnType<typeof loadFeatures>>,
): string[] {
  if (!features) return [];
  return matchFeaturesInPrompt(text, features.features);
}

/**
 * Pure-heuristic classifier. Returns a proposed scope, confidence in [0,1],
 * and the signals that drove the decision. Callers may invoke an LLM
 * tie-breaker when confidence < 0.8 and ambiguous=true.
 */
export function classifyHeuristic(
  lesson: string,
  ctx: ClassifyContext = {},
): ClassifyResult {
  const filesRaw = extractFiles(lesson, ctx.index);
  // Filter symbols that are actually file-path tokens (e.g. "package.json"
  // gets captured by both regexes). Files win the overlap.
  const fileSet = new Set(filesRaw);
  const symbols = extractSymbols(lesson, ctx.index).filter((s) => !fileSet.has(s));
  const files = filesRaw;
  const features = extractFeatures(lesson, ctx.features);

  const genericHits = lesson.match(GENERIC_QUANTIFIERS)?.length ?? 0;
  const policyHits = lesson.match(POLICY_VERBS)?.length ?? 0;

  const signals: string[] = [];
  if (symbols.length) signals.push(`symbols=${symbols.length}`);
  if (files.length) signals.push(`files=${files.length}`);
  if (features.length) signals.push(`features=${features.length}`);
  if (genericHits) signals.push(`generic=${genericHits}`);
  if (policyHits) signals.push(`policy=${policyHits}`);

  let scope: NoteScope = "global";
  let target: string | undefined;
  let confidence = 0.5;
  let ambiguous = false;

  // Decision table — prefer narrowest scope that is supported by evidence.
  // Highest-priority shortcut: a generic-quantifier lesson with no symbol
  // target is a repo-wide policy, even when a file is mentioned as context
  // (e.g. "Always run pnpm i after editing package.json"). One generic
  // word is enough when there's no specific symbol.
  if (genericHits >= 1 && symbols.length === 0 && features.length === 0) {
    scope = "global";
    target = undefined;
    confidence = 0.85;
    return {
      scope,
      target,
      confidence,
      signals,
      candidates: { symbols, files, features },
      ambiguous: false,
    };
  }
  if (symbols.length === 1 && genericHits === 0) {
    scope = "symbol";
    target = symbols[0];
    confidence = 0.9;
  } else if (symbols.length >= 2 && features.length >= 1) {
    scope = "feature";
    target = features[0];
    confidence = 0.85;
  } else if (files.length >= 1 && symbols.length === 0) {
    scope = "file";
    target = files[0];
    confidence = files.length === 1 ? 0.85 : 0.7;
    if (files.length > 1) ambiguous = true;
  } else if (features.length === 1 && symbols.length === 0) {
    scope = "feature";
    target = features[0];
    confidence = 0.8;
  } else if (genericHits >= 2 && symbols.length === 0 && files.length === 0) {
    scope = "global";
    confidence = 0.9;
  } else if (
    genericHits >= 1 &&
    policyHits >= 1 &&
    symbols.length === 0 &&
    files.length === 0
  ) {
    scope = "global";
    confidence = 0.8;
  } else if (symbols.length === 0 && files.length === 0 && features.length === 0) {
    scope = "global";
    confidence = 0.6;
    ambiguous = true;
  } else {
    // Multiple symbols, no feature alignment → ambiguous; default to first symbol.
    scope = "symbol";
    target = symbols[0];
    confidence = 0.55;
    ambiguous = true;
  }

  return {
    scope,
    target,
    confidence,
    signals,
    candidates: { symbols, files, features },
    ambiguous,
  };
}

export async function classifyLesson(
  root: string,
  lesson: string,
): Promise<ClassifyResult> {
  const [index, features] = await Promise.all([
    readIndex(root).catch(() => undefined),
    loadFeatures(root).catch(() => undefined),
  ]);
  return classifyHeuristic(lesson, { index, features });
}

/* ----------------------- persistence ----------------------- */

export interface PersistLessonOpts {
  scope: NoteScope;
  target?: string;
  lesson: string;
  evidence?: string;
  severity?: NoteSeverity;
  classifier?: ClassifierMeta;
}

export interface PersistLessonResult {
  id: string;
  scope: NoteScope;
  target?: string;
  path: string;
}

export async function persistLesson(
  root: string,
  opts: PersistLessonOpts,
): Promise<PersistLessonResult> {
  const id = generateLessonId();
  const recorded_at = new Date().toISOString().slice(0, 10);

  if (opts.scope === "global") {
    const { path: p } = await upsertGlobalLesson(root, {
      id,
      lesson: opts.lesson,
      severity: opts.severity ?? "medium",
      recorded_at,
    });
    return { id, scope: "global", path: p };
  }

  const target = opts.target;
  if (!target) {
    throw new Error(`scope=${opts.scope} requires a target`);
  }

  if (opts.scope === "symbol") {
    const { file } = await appendNote(root, {
      symbol: target,
      lesson: opts.lesson,
      evidence: opts.evidence,
      severity: opts.severity,
      source: "agent",
    });
    // appendNote doesn't know about id/scope/classifier yet — patch in place.
    await patchLastNoteMeta(root, file, id, "symbol", target, opts.classifier);
    return { id, scope: "symbol", target, path: file };
  }
  if (opts.scope === "file") {
    const { file } = await appendFileNote(root, {
      id,
      target,
      lesson: opts.lesson,
      evidence: opts.evidence,
      severity: opts.severity,
      classifier: opts.classifier,
    });
    return { id, scope: "file", target, path: file };
  }
  if (opts.scope === "feature") {
    const { file } = await appendFeatureNote(root, {
      id,
      target,
      lesson: opts.lesson,
      evidence: opts.evidence,
      severity: opts.severity,
      classifier: opts.classifier,
    });
    return { id, scope: "feature", target, path: file };
  }
  throw new Error(`unhandled scope: ${opts.scope}`);
}

/**
 * appendNote (the legacy symbol writer) doesn't accept id/scope/classifier yet.
 * Patch the most-recently-appended record in the YAML file. Keeps the public
 * surface backwards-compatible without rewriting appendNote.
 */
async function patchLastNoteMeta(
  root: string,
  relPath: string,
  id: string,
  scope: NoteScope,
  appliesTo: string,
  classifier?: ClassifierMeta,
): Promise<void> {
  const { readFile, writeFile } = await import("node:fs/promises");
  const { parse, stringify } = await import("yaml");
  const abs = path.join(root, relPath);
  const raw = await readFile(abs, "utf8");
  const data = parse(raw);
  if (!Array.isArray(data) || data.length === 0) return;
  const last = data[data.length - 1] as Record<string, unknown>;
  last.id = id;
  last.scope = scope;
  last.applies_to = appliesTo;
  if (classifier) last.classifier = classifier;
  await writeFile(abs, stringify(data));
}

/* ----------------------- listing + reclassify ----------------------- */

export async function listLessons(
  root: string,
  filter?: { scope?: NoteScope; target?: string },
): Promise<LessonEntry[]> {
  const out: LessonEntry[] = [];

  if (!filter?.scope || filter.scope === "global") {
    const global = await readGlobalLessons(root);
    for (const g of global) {
      if (filter?.target) continue;
      out.push({
        id: g.id,
        scope: "global",
        lesson: g.lesson,
        severity: g.severity,
        recorded_at: g.recorded_at,
        path: "CLAUDE.md",
      });
    }
  }

  if (!filter?.scope || filter.scope === "symbol") {
    const all = await loadAllNotes(root);
    for (const n of all) {
      if (filter?.target && (n.applies_to ?? n.symbol) !== filter.target) continue;
      out.push({
        id: n.id ?? deriveLegacyId(n.symbol, n.lesson, n.recorded_at),
        scope: "symbol",
        target: n.applies_to ?? n.symbol,
        lesson: n.lesson,
        severity: n.severity,
        recorded_at: n.recorded_at,
        path: `.dna/notes/${(n.applies_to ?? n.symbol).replace(/[/\\:]/g, "__").replace(/\./g, "_")}.yml`,
      });
    }
  }

  if (!filter?.scope || filter.scope === "file") {
    const files = await loadAllFileNotes(root);
    for (const { target, notes, path: p } of files) {
      if (filter?.target && target !== filter.target) continue;
      for (const n of notes) {
        out.push({
          id: n.id ?? deriveLegacyId(target, n.lesson, n.recorded_at),
          scope: "file",
          target,
          lesson: n.lesson,
          severity: n.severity,
          recorded_at: n.recorded_at,
          path: p,
        });
      }
    }
  }

  if (!filter?.scope || filter.scope === "feature") {
    const feats = await loadAllFeatureNotes(root);
    for (const { target, notes, path: p } of feats) {
      if (filter?.target && target !== filter.target) continue;
      for (const n of notes) {
        out.push({
          id: n.id ?? deriveLegacyId(target, n.lesson, n.recorded_at),
          scope: "feature",
          target,
          lesson: n.lesson,
          severity: n.severity,
          recorded_at: n.recorded_at,
          path: p,
        });
      }
    }
  }

  return out;
}

function deriveLegacyId(target: string, lesson: string, at: string): string {
  // Stable id from contents — used when older notes lack a stored id.
  return createHash("sha1")
    .update(`${target}\0${lesson}\0${at}`)
    .digest("hex")
    .slice(0, 16);
}

export interface ReclassifyOpts {
  id: string;
  to_scope: NoteScope;
  to_target?: string;
}

export interface ReclassifyResult {
  id: string;
  from_scope: NoteScope;
  from_target?: string;
  to_scope: NoteScope;
  to_target?: string;
  path: string;
}

export async function reclassifyLesson(
  root: string,
  opts: ReclassifyOpts,
): Promise<ReclassifyResult> {
  // Find the lesson across all scopes.
  const existing = await listLessons(root);
  const entry = existing.find((e) => e.id === opts.id);
  if (!entry) throw new Error(`no lesson with id=${opts.id}`);

  // Remove from current location.
  let payload: { lesson: string; severity: NoteSeverity; recorded_at: string };
  if (entry.scope === "global") {
    const { removed } = await removeGlobalLesson(root, entry.id);
    if (!removed) throw new Error(`could not remove ${entry.id} from CLAUDE.md`);
    payload = {
      lesson: removed.lesson,
      severity: removed.severity,
      recorded_at: removed.recorded_at,
    };
  } else {
    const removed = await removeNoteById(root, entry.id);
    if (!removed) throw new Error(`could not remove ${entry.id} from notes`);
    payload = {
      lesson: removed.note.lesson,
      severity: removed.note.severity,
      recorded_at: removed.note.recorded_at,
    };
  }

  // Write to new location, keeping the same id so external references still work.
  let path_: string;
  if (opts.to_scope === "global") {
    const { path: p } = await upsertGlobalLesson(root, {
      id: entry.id,
      lesson: payload.lesson,
      severity: payload.severity,
      recorded_at: payload.recorded_at,
    });
    path_ = p;
  } else {
    if (!opts.to_target) throw new Error(`to_scope=${opts.to_scope} requires to_target`);
    const writer =
      opts.to_scope === "symbol"
        ? appendNote
        : opts.to_scope === "file"
          ? appendFileNote
          : appendFeatureNote;
    if (opts.to_scope === "symbol") {
      const { file } = await appendNote(root, {
        symbol: opts.to_target,
        lesson: payload.lesson,
        severity: payload.severity,
      });
      await patchLastNoteMeta(root, file, entry.id, "symbol", opts.to_target);
      path_ = file;
    } else {
      const { file } = await (writer as typeof appendFileNote)(root, {
        id: entry.id,
        target: opts.to_target,
        lesson: payload.lesson,
        severity: payload.severity,
      });
      path_ = file;
    }
  }

  return {
    id: entry.id,
    from_scope: entry.scope,
    from_target: entry.target,
    to_scope: opts.to_scope,
    to_target: opts.to_target,
    path: path_,
  };
}
