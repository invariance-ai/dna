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
  id: z.string().optional(),
  name: z.string(),
  qualified_name: z.string().optional(),
  container: z.string().optional(),
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

export const JsonSchema = z.record(z.unknown());
export type JsonSchema = z.infer<typeof JsonSchema>;

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

/* ---------- Notes & Decisions (v0.2) ---------- */

export const NoteSeverity = z.enum(["low", "medium", "high"]);
export type NoteSeverity = z.infer<typeof NoteSeverity>;

export const NoteSource = z.enum(["agent", "human", "doc", "git", "promoted", "todo"]);
export type NoteSource = z.infer<typeof NoteSource>;

export const Note = z.object({
  symbol: z.string(),
  lesson: z.string(),
  evidence: z.string().optional(),
  severity: NoteSeverity.default("medium"),
  promoted: z.boolean().default(false),
  recorded_at: z.string(),
  source: NoteSource.default("agent"),
});
export type Note = z.infer<typeof Note>;

/**
 * Schema-only in v0.2. CLI lands in v0.4 (`dna attach --session`). Defined
 * now so data collected via future channels does not need migration.
 */
export const Decision = z.object({
  symbol: z.string(),
  decision: z.string(),
  rejected_alternative: z.string().optional(),
  rationale: z.string().optional(),
  made_by: z.string().optional(),
  session: z.string().optional(),
  recorded_at: z.string(),
});
export type Decision = z.infer<typeof Decision>;

/* ---------- Preferences (v0.3) ---------- */

export const PreferenceScope = z.enum(["repo", "user", "global"]);
export type PreferenceScope = z.infer<typeof PreferenceScope>;

export const PreferenceSource = z.enum(["manual", "auto", "wizard"]);
export type PreferenceSource = z.infer<typeof PreferenceSource>;

export const Preference = z.object({
  id: z.string(),
  text: z.string(),
  scope: PreferenceScope.default("repo"),
  topic: z.string().optional(),
  evidence: z.string().optional(),
  source: PreferenceSource.default("manual"),
  recorded_at: z.string(),
  hits: z.number().int().nonnegative().default(0),
});
export type Preference = z.infer<typeof Preference>;

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
  notes: z.array(Note).default([]),
  decisions: z.array(Decision).default([]),
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

export const RecordLearningInput = z.object({
  symbol: z.string(),
  lesson: z.string(),
  evidence: z.string().optional(),
  severity: NoteSeverity.default("medium"),
  source: NoteSource.default("agent"),
});
export type RecordLearningInput = z.infer<typeof RecordLearningInput>;
export const RecordLearningResult = z.object({
  note: Note,
  file: z.string(),
});
export type RecordLearningResult = z.infer<typeof RecordLearningResult>;

export const NotesForInput = z.object({
  symbol: z.string(),
  include_promoted: z.boolean().default(false),
});
export type NotesForInput = z.infer<typeof NotesForInput>;
export const NotesForResult = z.object({
  symbol: z.string(),
  notes: z.array(Note),
});
export type NotesForResult = z.infer<typeof NotesForResult>;

export const RecordDecisionInput = z.object({
  symbol: z.string(),
  decision: z.string(),
  rejected_alternative: z.string().optional(),
  rationale: z.string().optional(),
  made_by: z.string().optional(),
  session: z.string().optional(),
});
export type RecordDecisionInput = z.infer<typeof RecordDecisionInput>;
export const RecordDecisionResult = z.object({
  decision: Decision,
  file: z.string(),
});
export type RecordDecisionResult = z.infer<typeof RecordDecisionResult>;

export const DecisionsForInput = z.object({ symbol: z.string() });
export type DecisionsForInput = z.infer<typeof DecisionsForInput>;
export const DecisionsForResult = z.object({
  symbol: z.string(),
  decisions: z.array(Decision),
});
export type DecisionsForResult = z.infer<typeof DecisionsForResult>;

export const SuggestInput = z.object({
  min_count: z.number().int().min(1).default(3),
  limit: z.number().int().min(1).max(100).default(10),
});
export type SuggestInput = z.infer<typeof SuggestInput>;
export const Suggestion = z.object({
  symbol: z.string(),
  count: z.number().int().nonnegative(),
  last_queried: z.string(),
  reason: z.enum(["no_invariant", "no_note", "high_traffic"]),
});
export type Suggestion = z.infer<typeof Suggestion>;
export const SuggestResult = z.object({
  suggestions: z.array(Suggestion),
});
export type SuggestResult = z.infer<typeof SuggestResult>;

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
  notes: z.array(Note).default([]),
  decisions: z.array(Decision).default([]),
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
  record_learning: {
    description:
      "Persist a lesson learned about a symbol. Call after a non-trivial edit to make future agents and humans inherit what you discovered. Lessons are short, actionable, and tied to one symbol.",
    input: RecordLearningInput,
    output: RecordLearningResult,
  },
  notes_for: {
    description:
      "Lessons (notes) attached to a symbol. Returns un-promoted notes by default; set include_promoted to also see ones that have been lifted to invariants.",
    input: NotesForInput,
    output: NotesForResult,
  },
  record_decision: {
    description:
      "Persist a decision made about a symbol — a choice with the rejected alternative and rationale. Use when an explicit design choice was made that future agents and humans should not re-litigate.",
    input: RecordDecisionInput,
    output: RecordDecisionResult,
  },
  decisions_for: {
    description: "Decisions previously recorded for a symbol.",
    input: DecisionsForInput,
    output: DecisionsForResult,
  },
  suggest: {
    description:
      "Authoring queue: symbols agents have queried frequently that have no covering invariant. Use to find what's worth documenting next.",
    input: SuggestInput,
    output: SuggestResult,
  },
} as const;

export type ToolName = keyof typeof TOOLS;

export function toJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  return convertJsonSchema(schema);
}

function convertJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  if (schema instanceof z.ZodDefault || schema instanceof z.ZodOptional) {
    return convertJsonSchema(schema._def.innerType);
  }
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodNumber) {
    const out: Record<string, unknown> = { type: "number" };
    for (const check of schema._def.checks) {
      if (check.kind === "int") out.type = "integer";
      if (check.kind === "min") out.minimum = check.value;
      if (check.kind === "max") out.maximum = check.value;
    }
    return out;
  }
  if (schema instanceof z.ZodEnum) return { type: "string", enum: schema.options };
  if (schema instanceof z.ZodArray) {
    return { type: "array", items: convertJsonSchema(schema.element) };
  }
  if (schema instanceof z.ZodRecord) return { type: "object", additionalProperties: true };
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      const child = value as z.ZodTypeAny;
      properties[key] = convertJsonSchema(child);
      if (!(child instanceof z.ZodDefault) && !(child instanceof z.ZodOptional)) required.push(key);
    }
    return {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    };
  }
  return {};
}
