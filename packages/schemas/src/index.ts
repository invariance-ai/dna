import { z } from "zod";

/**
 * Single source of truth for dna's data shapes.
 * CLI args, MCP tool I/O, and HTTP OpenAPI all derive from these.
 */

export const SymbolRef = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int().nonnegative(),
  kind: z.enum(["function", "class", "method", "variable", "type", "module"]),
});
export type SymbolRef = z.infer<typeof SymbolRef>;

export const Edge = z.object({
  type: z.enum([
    "calls",
    "called_by",
    "imports",
    "imported_by",
    "reads",
    "writes",
    "tests",
    "tested_by",
    "inherits",
    "implements",
  ]),
  target: SymbolRef,
});
export type Edge = z.infer<typeof Edge>;

export const ProvenanceEntry = z.object({
  commit: z.string(),
  author: z.string(),
  date: z.string(),
  message: z.string(),
  is_breaking_change: z.boolean().optional(),
});
export type ProvenanceEntry = z.infer<typeof ProvenanceEntry>;

export const Invariant = z.object({
  name: z.string(),
  applies_to: z.array(z.string()),
  rule: z.string(),
  evidence: z.array(z.string()).default([]),
  severity: z.enum(["info", "warn", "block"]).default("warn"),
});
export type Invariant = z.infer<typeof Invariant>;

export const TestRef = z.object({
  file: z.string(),
  framework: z.enum(["jest", "vitest", "pytest", "mocha", "unknown"]),
  symbols_covered: z.array(z.string()).default([]),
  last_status: z.enum(["pass", "fail", "flaky", "unknown"]).default("unknown"),
});
export type TestRef = z.infer<typeof TestRef>;

/* ---------- Tool I/O ---------- */

export const GetContextInput = z.object({
  symbol: z.string().describe("Symbol name to look up. Fully qualified preferred."),
  depth: z.number().int().min(1).max(5).default(2),
  strands: z
    .array(z.enum(["structural", "tests", "provenance", "invariants"]))
    .default(["structural", "tests", "provenance", "invariants"]),
});
export type GetContextInput = z.infer<typeof GetContextInput>;

export const ContextResult = z.object({
  symbol: SymbolRef,
  edges: z.array(Edge),
  tests: z.array(TestRef),
  provenance: z.array(ProvenanceEntry),
  invariants: z.array(Invariant),
  risk: z.enum(["low", "medium", "high"]),
  token_count_estimate: z.number().int().nonnegative(),
});
export type ContextResult = z.infer<typeof ContextResult>;

export const ImpactInput = z.object({
  symbol: z.string(),
  hops: z.number().int().min(1).max(5).default(3),
});
export type ImpactInput = z.infer<typeof ImpactInput>;

export const ImpactResult = z.object({
  symbol: SymbolRef,
  affected_symbols: z.array(SymbolRef),
  affected_files: z.array(z.string()),
  affected_tests: z.array(TestRef),
  blast_radius: z.number().int().nonnegative(),
});
export type ImpactResult = z.infer<typeof ImpactResult>;

export const TestsForInput = z.object({ symbol: z.string() });
export const TestsForResult = z.object({ symbol: SymbolRef, tests: z.array(TestRef) });

export const InvariantsForInput = z.object({ symbol: z.string() });
export const InvariantsForResult = z.object({
  symbol: SymbolRef,
  invariants: z.array(Invariant),
});

export const FindReusableInput = z.object({
  query: z.string(),
  kind: SymbolRef.shape.kind.optional(),
  limit: z.number().int().min(1).max(50).default(10),
});
export const FindReusableResult = z.object({
  candidates: z.array(z.object({ symbol: SymbolRef, score: z.number(), snippet: z.string() })),
});

/**
 * Tool catalogue — referenced by CLI command registration and MCP server
 * registration so the surfaces cannot drift.
 */
export const TOOLS = {
  get_context: {
    description: "Full multi-strand context for a symbol before editing.",
    input: GetContextInput,
    output: ContextResult,
  },
  impact_of: {
    description: "Blast radius (symbols, files, tests) of changing a symbol.",
    input: ImpactInput,
    output: ImpactResult,
  },
  tests_for: {
    description: "Tests that protect a symbol — what to run after editing.",
    input: TestsForInput,
    output: TestsForResult,
  },
  invariants_for: {
    description: "Asserted invariants that apply before editing a symbol.",
    input: InvariantsForInput,
    output: InvariantsForResult,
  },
  find_reusable: {
    description: "Search the symbol graph for existing utilities to reuse.",
    input: FindReusableInput,
    output: FindReusableResult,
  },
} as const;

export type ToolName = keyof typeof TOOLS;
