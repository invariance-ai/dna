import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  FeaturesFile,
  type Feature,
  type FeatureSymbol,
  type FeaturesFile as FeaturesFileT,
} from "@invariance/dna-schemas";
import { readIndex, type DnaIndex } from "./index_store.js";

const FEATURES_REL = ".dna/features.yml";
const ACTIVE_REL = ".dna/session/active-feature";

export function featuresPath(root: string): string {
  return path.join(root, FEATURES_REL);
}
export function activeFeaturePath(root: string): string {
  return path.join(root, ACTIVE_REL);
}

export async function loadFeatures(root: string): Promise<FeaturesFileT> {
  try {
    const raw = await readFile(featuresPath(root), "utf8");
    const data = parseYaml(raw);
    return FeaturesFile.parse(data);
  } catch {
    return { version: 1, features: {} };
  }
}

export async function saveFeatures(root: string, file: FeaturesFileT): Promise<void> {
  const p = featuresPath(root);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, stringifyYaml(file));
}

export async function getActive(root: string): Promise<string | undefined> {
  try {
    const txt = (await readFile(activeFeaturePath(root), "utf8")).trim();
    return txt.length > 0 ? txt : undefined;
  } catch {
    return undefined;
  }
}

export async function clearActive(root: string): Promise<void> {
  try {
    await unlink(activeFeaturePath(root));
  } catch {
    /* not present */
  }
}

/**
 * Normalize a label to kebab-case-ish. Keep it conservative so agent-supplied
 * labels round-trip predictably.
 */
export function normalizeLabel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export interface SetActiveResult {
  label: string;
  created: boolean;
}

export async function setActive(root: string, rawLabel: string): Promise<SetActiveResult> {
  const label = normalizeLabel(rawLabel);
  if (!label) throw new Error("Feature label is empty after normalization");
  const features = await loadFeatures(root);
  const now = new Date().toISOString();
  let entry = features.features[label];
  if (!entry) {
    entry = {
      label,
      aliases: [],
      symbols: [],
      sessions: 0,
      created_at: now,
      last_active: now,
    };
    features.features[label] = entry;
  }
  const existed = entry.sessions > 0;
  entry.sessions += 1;
  entry.last_active = now;
  await saveFeatures(root, features);
  const sessionDir = path.dirname(activeFeaturePath(root));
  await mkdir(sessionDir, { recursive: true });
  // .dna/session/ is per-session state; never commit it.
  await writeFile(path.join(sessionDir, ".gitignore"), "*\n");
  await writeFile(activeFeaturePath(root), label);
  return { label, created: !existed };
}

/** Action signal magnitudes for the EWMA update. */
const SIGNAL = { edit: 1.0, read: 0.3 } as const;
const ALPHA = 0.3;

/** EWMA update: new = α·signal + (1-α)·prior, clamped to [0,1]. */
function ewma(prior: number, signal: number): number {
  const next = ALPHA * signal + (1 - ALPHA) * prior;
  return Math.max(0, Math.min(1, next));
}

export interface AttributeResult {
  label: string;
  touched_symbols: number;
  matched_files: string[];
  unmatched_files: string[];
}

/**
 * Bump the active (or given) feature's symbol weights for the listed files.
 * Files are matched against the existing symbol graph; symbols whose file
 * matches receive the action signal. Files not present in the index are
 * returned in unmatched_files (callers can warn).
 */
export async function attributeFiles(
  root: string,
  files: string[],
  action: "edit" | "read",
  label?: string,
): Promise<AttributeResult | undefined> {
  const target = label ?? (await getActive(root));
  if (!target) return undefined;
  const normalized = normalizeLabel(target);
  const features = await loadFeatures(root);
  if (!features.features[normalized]) {
    features.features[normalized] = {
      label: normalized,
      aliases: [],
      symbols: [],
      sessions: 1,
      created_at: new Date().toISOString(),
      last_active: new Date().toISOString(),
    };
  }
  const feature = features.features[normalized];

  let index: DnaIndex;
  try {
    index = await readIndex(root);
  } catch {
    return {
      label: normalized,
      touched_symbols: 0,
      matched_files: [],
      unmatched_files: files,
    };
  }

  const byFile = new Map<string, typeof index.symbols>();
  for (const s of index.symbols) {
    const list = byFile.get(s.file);
    if (list) list.push(s);
    else byFile.set(s.file, [s]);
  }

  const now = new Date().toISOString();
  const bySymbolId = new Map<string, FeatureSymbol>();
  for (const sym of feature.symbols) bySymbolId.set(sym.id, sym);

  const matched: string[] = [];
  const unmatched: string[] = [];
  let touched = 0;
  const signal = SIGNAL[action];

  for (const file of files) {
    const symbols = byFile.get(file);
    if (!symbols || symbols.length === 0) {
      unmatched.push(file);
      continue;
    }
    matched.push(file);
    for (const s of symbols) {
      if (!s.id) continue;
      const prior = bySymbolId.get(s.id);
      const next: FeatureSymbol = {
        id: s.id,
        weight: ewma(prior?.weight ?? 0, signal),
        edits: (prior?.edits ?? 0) + (action === "edit" ? 1 : 0),
        reads: (prior?.reads ?? 0) + (action === "read" ? 1 : 0),
        last_touched: now,
      };
      bySymbolId.set(s.id, next);
      touched += 1;
    }
  }

  feature.symbols = Array.from(bySymbolId.values()).sort((a, b) => b.weight - a.weight);
  feature.last_active = now;
  await saveFeatures(root, features);

  return {
    label: normalized,
    touched_symbols: touched,
    matched_files: matched,
    unmatched_files: unmatched,
  };
}

export interface TopSymbol {
  id: string;
  weight: number;
  edits: number;
  reads: number;
  last_touched: string;
}

export async function topSymbols(
  root: string,
  label: string,
  k = 10,
): Promise<TopSymbol[]> {
  const features = await loadFeatures(root);
  const feature = features.features[normalizeLabel(label)];
  if (!feature) return [];
  return feature.symbols.slice(0, k);
}

/**
 * Find features whose label or alias is mentioned in the prompt. Word-bounded,
 * case-insensitive. Used by context-from-prompt to surface learned features.
 */
export function matchFeaturesInPrompt(
  prompt: string,
  features: Record<string, Feature>,
): string[] {
  if (!prompt) return [];
  const lower = prompt.toLowerCase();
  const hits: string[] = [];
  for (const [label, feature] of Object.entries(features)) {
    const candidates = [label, ...(feature.aliases ?? [])];
    for (const cand of candidates) {
      const c = cand.toLowerCase().trim();
      if (!c) continue;
      // Word-bounded match. Allow hyphens to act as word chars.
      const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(?:^|[^a-z0-9-])${escaped}(?:[^a-z0-9-]|$)`, "i");
      if (re.test(lower)) {
        hits.push(label);
        break;
      }
    }
  }
  return hits;
}

export async function renameFeature(
  root: string,
  oldLabel: string,
  newLabel: string,
): Promise<boolean> {
  const from = normalizeLabel(oldLabel);
  const to = normalizeLabel(newLabel);
  if (!from || !to || from === to) return false;
  const features = await loadFeatures(root);
  const src = features.features[from];
  if (!src) return false;
  if (features.features[to]) {
    // Destination exists — fall through to merge semantics.
    mergeInto(features, from, to);
    await saveFeatures(root, features);
    const activeNow = await getActive(root);
    if (activeNow && normalizeLabel(activeNow) === from) {
      await writeFile(activeFeaturePath(root), to);
    }
    return true;
  }
  src.label = to;
  features.features[to] = src;
  delete features.features[from];
  await saveFeatures(root, features);
  const active = await getActive(root);
  if (active && normalizeLabel(active) === from) {
    await writeFile(activeFeaturePath(root), to);
  }
  return true;
}

export async function mergeFeatures(
  root: string,
  fromLabel: string,
  intoLabel: string,
): Promise<boolean> {
  const from = normalizeLabel(fromLabel);
  const into = normalizeLabel(intoLabel);
  if (!from || !into || from === into) return false;
  const features = await loadFeatures(root);
  if (!features.features[from] || !features.features[into]) return false;
  mergeInto(features, from, into);
  await saveFeatures(root, features);
  return true;
}

function mergeInto(file: FeaturesFileT, from: string, into: string): void {
  const src = file.features[from];
  const dst = file.features[into];
  if (!src || !dst) return;
  const bySymbolId = new Map<string, FeatureSymbol>();
  for (const sym of dst.symbols) bySymbolId.set(sym.id, sym);
  for (const sym of src.symbols) {
    const prior = bySymbolId.get(sym.id);
    if (!prior) {
      bySymbolId.set(sym.id, sym);
      continue;
    }
    bySymbolId.set(sym.id, {
      id: sym.id,
      weight: Math.max(prior.weight, sym.weight),
      edits: prior.edits + sym.edits,
      reads: prior.reads + sym.reads,
      last_touched:
        prior.last_touched > sym.last_touched ? prior.last_touched : sym.last_touched,
    });
  }
  dst.symbols = Array.from(bySymbolId.values()).sort((a, b) => b.weight - a.weight);
  dst.aliases = Array.from(new Set([...(dst.aliases ?? []), from, ...(src.aliases ?? [])]));
  dst.sessions += src.sessions;
  dst.last_active = dst.last_active > src.last_active ? dst.last_active : src.last_active;
  delete file.features[from];
}
