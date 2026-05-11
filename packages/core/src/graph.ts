import type { SymbolRef } from "@invariance/dna-schemas";
import type { ResolvedEdge } from "./resolver.js";

/**
 * Graph store. v0 wraps Kuzu (embedded). Schema:
 *   (:Symbol {name, file, line, kind})
 *   -[:CALLS|READS|WRITES|TESTS|IMPORTS|INHERITS|IMPLEMENTS]->
 *   (:Symbol)
 *
 * Stored at .dna/index/graph.kuzu — gitignored.
 */
export interface GraphStore {
  upsertSymbol(s: SymbolRef): Promise<void>;
  upsertEdge(e: ResolvedEdge): Promise<void>;
  neighbors(name: string, hops: number): Promise<SymbolRef[]>;
  callers(name: string): Promise<SymbolRef[]>;
  callees(name: string): Promise<SymbolRef[]>;
  close(): Promise<void>;
}

export async function open(_dir: string): Promise<GraphStore> {
  throw new Error("graph.open: not implemented");
}
