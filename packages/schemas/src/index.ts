import { z } from "zod";

/**
 * Single source of truth for dna's data shapes.
 * CLI args, MCP tool I/O, and HTTP OpenAPI all derive from these.
 */

export const SymbolKind = z.enum([
  "function",
  "class",
  "method",
  "variable",
  "type",
  "module",
]);
export type SymbolKind = z.infer<typeof SymbolKind>;

export const SymbolRef = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int().nonnegative(),
  kind: SymbolKind,
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
});
export type TestRef = z.infer<typeof TestRef>;

/* ---------- Tool I/O ---------- */

export const Strand = z.enum(["structural", "tests", "provenance", "invariants"]);
export type Strand = z.infer<typeof Strand>;

export const GetContextInput = z.object({
  symbol: z.string(),
  depth: z.number().int().min(1).max(5).default(2),
  strands: z.array(Strand).default(["structural", "tests", "provenance", "invariants"]),
});
export type GetContextInput = z.infer<typeof GetContextInput>;

export const ContextResult = z.object({
  symbol: SymbolRef,
  callers: z.array(SymbolRef),
  callees: z.array(SymbolRef),
  tests: z.array(TestRef),
  provenance: z.array(ProvenanceEntry),
  invariants: z.array(Invariant),
  risk: z.enum(["low", "medium", "high"]),
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
export type TestsForInput = z.infer<typeof TestsForInput>;
export const TestsForResult = z.object({ symbol: SymbolRef, tests: z.array(TestRef) });
export type TestsForResult = z.infer<typeof TestsForResult>;

export const InvariantsForInput = z.object({ symbol: z.string() });
export type InvariantsForInput = z.infer<typeof InvariantsForInput>;
export const InvariantsForResult = z.object({
  symbol: z.string(),
  invariants: z.array(Invariant),
});
export type InvariantsForResult = z.infer<typeof InvariantsForResult>;

export const FindReusableInput = z.object({
  query: z.string(),
  kind: SymbolKind.optional(),
  limit: z.number().int().min(1).max(50).default(10),
});
export type FindReusableInput = z.infer<typeof FindReusableInput>;
export const FindReusableResult = z.object({
  candidates: z.array(z.object({ symbol: SymbolRef, score: z.number() })),
});
export type FindReusableResult = z.infer<typeof FindReusableResult>;

/**
 * Meta-tool: agent calls this with a symbol it's about to edit and a short
 * description. We return a single decision-ready brief (structural + tests +
 * invariants + risk) optimised for the LLM, not for chaining.
 */
export const PrepareEditInput = z.object({
  symbol: z.string(),
  intent: z.string().describe("What the agent plans to change, in one sentence."),
});
export type PrepareEditInput = z.infer<typeof PrepareEditInput>;
export const PrepareEditResult = z.object({
  markdown: z.string(),
  invariants_to_respect: z.array(Invariant),
  tests_to_run: z.array(z.string()),
  risk: z.enum(["low", "medium", "high"]),
});
export type PrepareEditResult = z.infer<typeof PrepareEditResult>;

/**
 * Tool catalogue — referenced by CLI command registration and MCP server
 * registration so the surfaces cannot drift.
 */
export const TOOLS = {
  prepare_edit: {
    description:
      "Single decision-ready brief before editing a symbol. Returns structure, tests, invariants, and risk in one shot. Call this first when about to modify code.",
    input: PrepareEditInput,
    output: PrepareEditResult,
  },
  get_context: {
    description: "Full multi-strand context for a symbol.",
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
