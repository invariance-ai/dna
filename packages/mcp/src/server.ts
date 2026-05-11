import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { TOOLS, type ToolName } from "@invariance/dna-schemas";
import {
  open as openQuery,
  getContext,
  impactOf,
  prepareEdit,
  resolveSymbol,
  testsForSymbol,
  loadInvariants,
  invariantsFor,
  loadNotes,
  appendNote,
  rankNotes,
  loadDecisions,
  appendDecision,
  rankDecisions,
} from "@invariance/dna-core";

/**
 * Tool metadata flows from @invariance/dna-schemas so CLI flags, MCP tool I/O,
 * and HTTP OpenAPI stay in sync. Indexes are read from the cwd's .dna/ on each
 * call — cheap because the index is a single JSON file.
 */
const server = new Server(
  { name: "dna", version: "0.0.1" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(TOOLS).map(([name, def]) => ({
    name,
    description: def.description,
    inputSchema: toJsonSchema(def.input),
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name as ToolName;
  const args = req.params.arguments ?? {};
  const def = TOOLS[name];
  if (!def) throw new Error(`Unknown tool: ${name}`);
  const parsed = def.input.parse(args);
  const result = await dispatch(name, parsed);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

async function dispatch(name: ToolName, args: unknown): Promise<unknown> {
  const root = process.cwd();
  switch (name) {
    case "prepare_edit":
      return prepareEdit(args as Parameters<typeof prepareEdit>[0], root);
    case "get_context":
      return getContext(args as Parameters<typeof getContext>[0], root);
    case "impact_of":
      return impactOf(args as Parameters<typeof impactOf>[0], root);
    case "tests_for": {
      const a = args as { symbol: string };
      const ctx = await openQuery(root);
      const sym = resolveSymbol(a.symbol, ctx);
      if (!sym) throw new Error(`symbol not found: ${a.symbol}`);
      const tests = await testsForSymbol(sym.name, sym.file, root, ctx.index);
      return { symbol: sym, tests };
    }
    case "invariants_for": {
      const a = args as { symbol: string };
      const all = await loadInvariants(root);
      return { symbol: a.symbol, invariants: invariantsFor(a.symbol, all) };
    }
    case "record_learning": {
      const a = args as {
        symbol: string;
        lesson: string;
        evidence?: string;
        severity?: "low" | "medium" | "high";
        source?: "agent" | "human" | "doc" | "git" | "promoted" | "todo";
      };
      return appendNote(root, a);
    }
    case "notes_for": {
      const a = args as { symbol: string; include_promoted?: boolean };
      const all = await loadNotes(root, a.symbol);
      const notes = rankNotes(all, Number.POSITIVE_INFINITY, !!a.include_promoted);
      return { symbol: a.symbol, notes };
    }
    case "record_decision": {
      const a = args as Parameters<typeof appendDecision>[1];
      return appendDecision(root, a);
    }
    case "decisions_for": {
      const a = args as { symbol: string };
      const decisions = rankDecisions(await loadDecisions(root, a.symbol), Number.POSITIVE_INFINITY);
      return { symbol: a.symbol, decisions };
    }
    case "find_reusable": {
      const a = args as { query: string; kind?: string; limit?: number };
      const ctx = await openQuery(root);
      const q = a.query.toLowerCase();
      const cands = ctx.index.symbols
        .map((s) => {
          if (a.kind && s.kind !== a.kind) return null;
          const n = s.name.toLowerCase();
          const qn = s.qualified_name?.toLowerCase();
          let score = 0;
          if (qn === q) score = 1;
          else if (n === q) score = 0.95;
          else if (qn?.startsWith(q)) score = 0.85;
          else if (n.startsWith(q)) score = 0.8;
          else if (qn?.includes(q)) score = 0.65;
          else if (n.includes(q)) score = 0.6;
          else return null;
          return { symbol: s, score };
        })
        .filter((x): x is { symbol: typeof ctx.index.symbols[0]; score: number } => !!x)
        .sort((a, b) => b.score - a.score)
        .slice(0, a.limit ?? 10);
      return { candidates: cands };
    }
    default:
      throw new Error(`Tool ${name} dispatch not implemented`);
  }
}

const transport = new StdioServerTransport();
await server.connect(transport);

function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodDefault || schema instanceof z.ZodOptional) {
    return toJsonSchema(schema._def.innerType);
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
  if (schema instanceof z.ZodArray) return { type: "array", items: toJsonSchema(schema.element) };
  if (schema instanceof z.ZodObject) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(schema.shape)) {
      const child = value as z.ZodTypeAny;
      properties[key] = toJsonSchema(child);
      if (!(child instanceof z.ZodDefault) && !(child instanceof z.ZodOptional)) required.push(key);
    }
    return { type: "object", properties, required, additionalProperties: false };
  }
  return {};
}
