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
  symbols: SymbolRef[];
  edges: Array<{ from: string; to: string; type: "calls" }>;
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
  const byName = new Map<string, SymbolRef>();
  for (const file of parsed) {
    for (const s of file.symbols) {
      const rel: SymbolRef = {
        ...s,
        file: path.relative(root, s.file),
      };
      symbols.push(rel);
      if (!byName.has(rel.name)) byName.set(rel.name, rel);
    }
  }

  const edges: DnaIndex["edges"] = [];
  for (const file of parsed) {
    for (const cs of file.call_sites) {
      if (!byName.has(cs.callee_name)) continue; // skip externals/built-ins
      if (cs.from === "<module>" || cs.from === cs.callee_name) continue;
      edges.push({ from: cs.from, to: cs.callee_name, type: "calls" });
    }
  }

  return {
    version: 1,
    built_at: new Date().toISOString(),
    root,
    symbols,
    edges,
  };
}
