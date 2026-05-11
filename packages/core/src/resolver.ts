import type { SymbolRef } from "@invariance/dna-schemas";
import type { ParsedFile } from "./parser.js";

/**
 * Resolve call sites to symbol definitions across files.
 * v0: language-server backed (tsserver, pyright) for high precision.
 */
export interface ResolvedEdge {
  from: SymbolRef;
  to: SymbolRef;
  type: "calls" | "imports" | "reads" | "writes" | "inherits" | "implements";
}

export async function resolve(_files: ParsedFile[]): Promise<ResolvedEdge[]> {
  throw new Error("resolver.resolve: not implemented");
}
