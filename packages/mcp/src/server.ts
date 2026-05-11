import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS, type ToolName } from "@invariance/dna-schemas";
import { getContext, impactOf } from "@invariance/dna-core";

/**
 * Single registration loop — tool metadata flows from @invariance/dna-schemas
 * so CLI flags, MCP tool input/output schemas, and HTTP OpenAPI stay in sync.
 */
const server = new Server(
  { name: "dna", version: "0.0.1" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(TOOLS).map(([name, def]) => ({
    name,
    description: def.description,
    inputSchema: zodToJsonSchema(def.input),
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
  switch (name) {
    case "get_context":
      return getContext(args as Parameters<typeof getContext>[0]);
    case "impact_of":
      return impactOf(args as Parameters<typeof impactOf>[0]);
    default:
      throw new Error(`Tool ${name} dispatch not yet implemented`);
  }
}

// Minimal zod→JSON-schema until we wire a real codegen step.
function zodToJsonSchema(_schema: unknown): Record<string, unknown> {
  return { type: "object", additionalProperties: true };
}

const transport = new StdioServerTransport();
await server.connect(transport);
