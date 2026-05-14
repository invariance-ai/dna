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

export const NoteSource = z.enum([
  "agent",
  "human",
  "doc",
  "git",
  "promoted",
  "todo",
  "pr",
  "incident",
  "transcript",
  "seed",
  "pulse",
]);
export type NoteSource = z.infer<typeof NoteSource>;

/**
 * Where a lesson lives. `symbol` is the legacy default and remains the storage
 * for `.dna/notes/{symbol}.yml`. `file` and `feature` write to dedicated
 * subdirectories. `global` lives in the CLAUDE.md `dna:global-lessons` block.
 */
export const NoteScope = z.enum(["symbol", "file", "feature", "global"]);
export type NoteScope = z.infer<typeof NoteScope>;

export const ClassifierMeta = z.object({
  signals: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  used_llm: z.boolean().default(false),
  model: z.string().optional(),
});
export type ClassifierMeta = z.infer<typeof ClassifierMeta>;

export const Note = z.object({
  symbol: z.string(),
  lesson: z.string(),
  evidence: z.string().optional(),
  severity: NoteSeverity.default("medium"),
  promoted: z.boolean().default(false),
  recorded_at: z.string(),
  source: NoteSource.default("agent"),
  /** Stable identifier so a lesson can be moved between scopes by id. */
  id: z.string().optional(),
  scope: NoteScope.default("symbol"),
  /** Concrete target for the scope: symbol name, file path, or feature label. */
  applies_to: z.string().optional(),
  classifier: ClassifierMeta.optional(),
  /** Provenance: link to a PR#, commit SHA, file:line, transcript ID, or URL. */
  evidence_link: z.string().optional(),
  /** Derived confidence in this note (0..1). 1.0 = human-verified; lower = LLM-distilled. */
  confidence: z.number().min(0).max(1).optional(),
  /** Identity of human who reviewed this note (email or git username). */
  verified_by: z.string().optional(),
  verified_at: z.string().optional(),
  /** Author identity recorded at write time (git user.email when available). */
  author: z.string().optional(),
});
export type Note = z.infer<typeof Note>;

/**
 * Schema-only in v0.2. CLI lands in v0.4 (`dna attach --session`). Defined
 * now so data collected via future channels does not need migration.
 */
export const DecisionSource = z.enum([
  "human",
  "agent",
  "transcript",
  "pr",
  "seed",
  "promoted",
]);
export type DecisionSource = z.infer<typeof DecisionSource>;

export const Decision = z.object({
  symbol: z.string(),
  decision: z.string(),
  rejected_alternative: z.string().optional(),
  rationale: z.string().optional(),
  made_by: z.string().optional(),
  session: z.string().optional(),
  recorded_at: z.string(),
  /** Stable id so the decision can be reclassified / verified by id. */
  id: z.string().optional(),
  source: DecisionSource.default("human"),
  evidence_link: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  verified_by: z.string().optional(),
  verified_at: z.string().optional(),
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

/* ---------- Features (v0.4) ---------- */

export const FeatureSymbol = z.object({
  id: z.string(),
  weight: z.number().min(0).max(1),
  edits: z.number().int().nonnegative().default(0),
  reads: z.number().int().nonnegative().default(0),
  last_touched: z.string(),
  /**
   * Confidence of the most recent attribution: 1 / number_of_symbols_in_file.
   * Low values mean the file is a shared utility — the weight bump is noisy.
   */
  last_confidence: z.number().min(0).max(1).optional(),
});
export type FeatureSymbol = z.infer<typeof FeatureSymbol>;

/* ---------- Assumptions (v0.5+) ---------- */

export const AssumptionConfidence = z.enum(["low", "medium", "high"]);
export type AssumptionConfidence = z.infer<typeof AssumptionConfidence>;

export const AssumptionSource = z.enum(["agent", "human", "llm"]);
export type AssumptionSource = z.infer<typeof AssumptionSource>;

export const Assumption = z.object({
  id: z.string(),
  symbol: z.string(),
  statement: z.string(),
  confidence: AssumptionConfidence.default("medium"),
  verified: z.boolean().default(false),
  verified_at: z.string().optional(),
  evidence: z.string().optional(),
  source: AssumptionSource.default("human"),
  recorded_at: z.string(),
});
export type Assumption = z.infer<typeof Assumption>;

/* ---------- Questions (v0.5) ---------- */

export const QuestionStatus = z.enum(["unresolved", "resolved", "wontfix"]);
export type QuestionStatus = z.infer<typeof QuestionStatus>;

export const Question = z.object({
  id: z.string(),
  symbol: z.string(),
  question: z.string(),
  asked_by: z.string().optional(),
  session: z.string().optional(),
  status: QuestionStatus.default("unresolved"),
  resolution: z.string().optional(),
  recorded_at: z.string(),
  resolved_at: z.string().optional(),
});
export type Question = z.infer<typeof Question>;

export const Feature = z.object({
  label: z.string(),
  aliases: z.array(z.string()).default([]),
  symbols: z.array(FeatureSymbol).default([]),
  sessions: z.number().int().nonnegative().default(0),
  created_at: z.string(),
  last_active: z.string(),
});
export type Feature = z.infer<typeof Feature>;

export const FeaturesFile = z.object({
  version: z.literal(1),
  features: z.record(z.string(), Feature).default({}),
});
export type FeaturesFile = z.infer<typeof FeaturesFile>;

/* ---------- Tool I/O ---------- */

export const Strand = z.enum(["structural", "tests", "provenance", "invariants"]);
export type Strand = z.infer<typeof Strand>;

export const ContextMode = z.enum(["brief", "full"]);
export type ContextMode = z.infer<typeof ContextMode>;

export const GetContextInput = z.object({
  symbol: z.string(),
  depth: z.number().int().min(1).max(5).default(2),
  strands: z.array(Strand).default(["structural", "tests", "provenance", "invariants"]),
  since: z.string().optional(),
  authored_by: z.string().optional(),
  mode: ContextMode.optional(),
  budget: z.number().int().nonnegative().optional(),
});
export type GetContextInput = z.infer<typeof GetContextInput>;

export const TodoItem = z.object({
  id: z.string(),
  file: z.string(),
  line: z.number().int().nonnegative().optional(),
  symbol: z.string().optional(),
  text: z.string(),
  source: z.enum(["failure", "note", "manual"]),
  created_at: z.string(),
  resolved_at: z.string().optional(),
});
export type TodoItem = z.infer<typeof TodoItem>;

export const ContextResult = z.object({
  symbol: SymbolRef,
  callers: z.array(SymbolRef),
  callees: z.array(SymbolRef),
  tests: z.array(TestRef),
  provenance: z.array(ProvenanceEntry),
  invariants: z.array(Invariant),
  notes: z.array(Note).default([]),
  decisions: z.array(Decision).default([]),
  preferences: z.array(Preference).default([]),
  risk: z.enum(["low", "medium", "high"]),
  todos: z.array(TodoItem).default([]),
  truncated: z
    .object({ sections: z.array(z.string()), droppedCount: z.number().int().nonnegative() })
    .optional(),
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

/* ---------- Lessons (v0.6 — tiered scope) ---------- */

export const RecordLessonInput = z.object({
  lesson: z.string(),
  evidence: z.string().optional(),
  severity: NoteSeverity.default("medium"),
  /** Optional scope hint. When set, classifier still runs for signals but does not override. */
  hint_scope: NoteScope.optional(),
  /** Optional target hint (symbol name, file path, feature label). */
  hint_target: z.string().optional(),
  /** Hard override: skip classification entirely. */
  force_scope: NoteScope.optional(),
  force_target: z.string().optional(),
  /** Compute classification without writing. */
  dry_run: z.boolean().default(false),
  /** Skip the LLM tie-breaker. Heuristic top label is used regardless of confidence. */
  no_llm: z.boolean().default(false),
});
export type RecordLessonInput = z.infer<typeof RecordLessonInput>;

export const RecordLessonResult = z.object({
  scope: NoteScope,
  target: z.string().optional(),
  path: z.string(),
  id: z.string(),
  signals: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  used_llm: z.boolean().default(false),
  dry_run: z.boolean().default(false),
});
export type RecordLessonResult = z.infer<typeof RecordLessonResult>;

export const LessonsListInput = z.object({
  scope: NoteScope.optional(),
  target: z.string().optional(),
});
export type LessonsListInput = z.infer<typeof LessonsListInput>;

export const LessonEntry = z.object({
  id: z.string(),
  scope: NoteScope,
  target: z.string().optional(),
  lesson: z.string(),
  severity: NoteSeverity,
  recorded_at: z.string(),
  path: z.string(),
});
export type LessonEntry = z.infer<typeof LessonEntry>;

export const LessonsListResult = z.object({
  lessons: z.array(LessonEntry),
});
export type LessonsListResult = z.infer<typeof LessonsListResult>;

export const ReclassifyLessonInput = z.object({
  id: z.string(),
  to_scope: NoteScope,
  to_target: z.string().optional(),
});
export type ReclassifyLessonInput = z.infer<typeof ReclassifyLessonInput>;

export const ReclassifyLessonResult = z.object({
  id: z.string(),
  from_scope: NoteScope,
  from_target: z.string().optional(),
  to_scope: NoteScope,
  to_target: z.string().optional(),
  path: z.string(),
});
export type ReclassifyLessonResult = z.infer<typeof ReclassifyLessonResult>;

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
  budget: z.number().int().positive().optional().describe(
    "Optional token budget; sections are dropped tail-first when exceeded.",
  ),
  since: z.string().optional().describe(
    "ISO date or relative like '7d'/'2w'/'3mo'; drops notes/decisions/questions older than this.",
  ),
  depth: z.number().int().min(1).max(3).optional().describe(
    "Neighborhood depth for callee context (1 = symbol only).",
  ),
});
export type PrepareEditInput = z.infer<typeof PrepareEditInput>;
export const PrepareEditResult = z.object({
  markdown: z.string(),
  invariants_to_respect: z.array(Invariant),
  notes: z.array(Note).default([]),
  decisions: z.array(Decision).default([]),
  preferences: z.array(Preference).default([]),
  tests_to_run: z.array(z.string()),
  risk: z.enum(["low", "medium", "high"]),
});
export type PrepareEditResult = z.infer<typeof PrepareEditResult>;

/* ---------- Pulse: diff-time risk (v0.7) ---------- */

export const PulseSeverity = z.enum(["info", "low", "medium", "high", "block"]);
export type PulseSeverity = z.infer<typeof PulseSeverity>;

export const PulseFinding = z.object({
  kind: z.enum([
    "invariant_hit",
    "untested_caller",
    "note_ignored",
    "decision_contradicted",
    "stale_note",
  ]),
  severity: PulseSeverity,
  symbol: z.string().optional(),
  file: z.string().optional(),
  message: z.string(),
  evidence: z.string().optional(),
});
export type PulseFinding = z.infer<typeof PulseFinding>;

export const PulseInput = z.object({
  base: z.string().default("HEAD"),
  files: z.array(z.string()).optional(),
  /** Output format: markdown | json | github (PR comment body). */
  format: z.enum(["markdown", "json", "github"]).default("markdown"),
});
export type PulseInput = z.infer<typeof PulseInput>;

export const PulseResult = z.object({
  base: z.string(),
  changed_files: z.array(z.string()),
  changed_symbols: z.array(z.string()),
  findings: z.array(PulseFinding),
  risk_score: z.number().min(0).max(1),
  risk_band: z.enum(["low", "medium", "high", "block"]),
  markdown: z.string(),
});
export type PulseResult = z.infer<typeof PulseResult>;

/* ---------- Seed: cold-start bootstrap (v0.7) ---------- */

export const SeedProposal = z.object({
  kind: z.enum(["note", "decision", "invariant"]),
  symbol: z.string().optional(),
  applies_to: z.array(z.string()).default([]),
  text: z.string(),
  evidence_link: z.string().optional(),
  source: z.enum(["pr", "git", "incident", "todo"]),
  confidence: z.number().min(0).max(1),
});
export type SeedProposal = z.infer<typeof SeedProposal>;

export const SeedResult = z.object({
  proposals: z.array(SeedProposal),
  scanned: z.object({
    commits: z.number().int().nonnegative(),
    prs: z.number().int().nonnegative(),
    todos: z.number().int().nonnegative(),
  }),
});
export type SeedResult = z.infer<typeof SeedResult>;

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
  record_lesson: {
    description:
      "Persist a lesson and let dna classify its scope (symbol|file|feature|global). Repo-wide lessons go to the CLAUDE.md managed block (always loaded); scoped lessons go to .dna/notes/* (pulled on-demand). Pass hint_scope/hint_target to bias the classifier, or force_scope to skip it. Use this in preference to record_learning when the lesson may not belong to a single symbol.",
    input: RecordLessonInput,
    output: RecordLessonResult,
  },
  lessons_list: {
    description: "List recorded lessons across scopes. Filter by scope or target.",
    input: LessonsListInput,
    output: LessonsListResult,
  },
  reclassify_lesson: {
    description:
      "Move a lesson between scopes (e.g. promote a scoped note to CLAUDE.md or demote a global lesson to a symbol/file).",
    input: ReclassifyLessonInput,
    output: ReclassifyLessonResult,
  },
  list_todos: {
    description:
      "List TODOs DNA has captured for a file or symbol. Surfaces unfinished work (failed tests, captured notes) without editing source files.",
    input: z.object({
      file: z.string().optional(),
      symbol: z.string().optional(),
      include_resolved: z.boolean().optional(),
    }),
    output: z.object({ todos: z.array(TodoItem) }),
  },
  resolve_todo: {
    description: "Mark a DNA-tracked TODO as resolved by id.",
    input: z.object({ id: z.string() }),
    output: z.object({ resolved: z.boolean() }),
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
