import type { SymbolRef } from "@invariance/dna-schemas";

/**
 * Walk a repo with tree-sitter and emit a SymbolRef per declaration.
 *
 * v0: TypeScript + Python. Stub here; real impl wires tree-sitter grammars
 * and traverses AST nodes (function_declaration, class_declaration, etc.).
 */
export interface ParsedFile {
  path: string;
  symbols: SymbolRef[];
  call_sites: Array<{ callee_name: string; line: number; from: string }>;
}

export async function parseFile(_path: string): Promise<ParsedFile> {
  throw new Error("parser.parseFile: not implemented");
}

export async function parseRepo(_root: string): Promise<ParsedFile[]> {
  throw new Error("parser.parseRepo: not implemented");
}
