import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { SymbolRef } from "@invariance/dna-schemas";
import type { ParsedFile } from "./parser.js";

/**
 * v0.1 storage: a single JSON file at .dna/index/symbols.json.
 *
 * Why not SQLite/Kuzu yet: design-eval recommended SQLite, but for v0.1 the
 * dataset fits in memory comfortably (< 1MB per 100k LOC after compaction),
 * and JSON keeps `npm install -g @invariance/dna` zero-native-deps. SQLite
 * lands when repos in the wild push us past ~500k LOC or we need incremental
 * persistence between watch ticks.
 */
export interface DnaIndex {
  version: 1;
  built_at: string;
  root: string;
  files: string[];
  symbols: SymbolRef[];
  edges: Array<{
    from: string;
    to: string;
    from_id?: string;
    to_id?: string;
    type: "calls";
    file?: string;
    line?: number;
  }>;
}

const REL = ".dna/index/symbols.json";

export function indexPath(root: string): string {
  return path.join(root, REL);
}

export async function writeIndex(root: string, index: DnaIndex): Promise<void> {
  const p = indexPath(root);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(index, null, 2));
}

export async function readIndex(root: string): Promise<DnaIndex> {
  const raw = await readFile(indexPath(root), "utf8");
  return JSON.parse(raw) as DnaIndex;
}

export function buildIndex(root: string, parsed: ParsedFile[]): DnaIndex {
  const symbols: SymbolRef[] = [];
  const byName = new Map<string, SymbolRef[]>();
  const byQualifiedName = new Map<string, SymbolRef>();
  const byFileAndName = new Map<string, SymbolRef[]>();
  for (const file of parsed) {
    for (const s of file.symbols) {
      const relFile = path.relative(root, s.file);
      const qualified_name = s.qualified_name ?? s.name;
      const rel: SymbolRef = {
        ...s,
        id: symbolId(relFile, qualified_name, s.line),
        qualified_name,
        file: relFile,
      };
      symbols.push(rel);
      push(byName, rel.name, rel);
      push(byFileAndName, `${rel.file}:${rel.name}`, rel);
      if (!byQualifiedName.has(qualified_name)) byQualifiedName.set(qualified_name, rel);
    }
  }

  const edges: DnaIndex["edges"] = [];
  for (const file of parsed) {
    const relFile = path.relative(root, file.path);
    for (const cs of file.call_sites) {
      if (cs.from === "<module>" || cs.from === cs.callee_name) continue;
      const from = resolveLocalSymbol(relFile, cs.from, byFileAndName, byQualifiedName, byName);
      const to = resolveLocalSymbol(relFile, cs.callee_name, byFileAndName, byQualifiedName, byName);
      if (!from || !to) continue; // skip externals/built-ins/ambiguous globals
      edges.push({
        from: from.qualified_name ?? from.name,
        to: to.qualified_name ?? to.name,
        from_id: from.id,
        to_id: to.id,
        type: "calls",
        file: relFile,
        line: cs.line,
      });
    }
  }

  return {
    version: 1,
    built_at: new Date().toISOString(),
    root,
    files: parsed.map((file) => path.relative(root, file.path)),
    symbols,
    edges,
  };
}

function symbolId(file: string, qualifiedName: string, line: number): string {
  return `${file}#${qualifiedName}:${line}`;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

function resolveLocalSymbol(
  file: string,
  name: string,
  byFileAndName: Map<string, SymbolRef[]>,
  byQualifiedName: Map<string, SymbolRef>,
  byName: Map<string, SymbolRef[]>,
): SymbolRef | undefined {
  const fileMatches = byFileAndName.get(`${file}:${name}`);
  if (fileMatches?.length === 1) return fileMatches[0];
  const qualified = byQualifiedName.get(name);
  if (qualified) return qualified;
  const globalMatches = byName.get(name);
  if (globalMatches?.length === 1) return globalMatches[0];
  return undefined;
}
