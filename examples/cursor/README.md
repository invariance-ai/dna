# Using dna with Cursor

Cursor agents have shell access and read project rules from `.cursor/rules/*.mdc`. dna installs an always-attached rule plus an MCP server entry.

## Install

```bash
cd your-repo
npx -y @invariance/dna init
npx -y @invariance/dna install cursor
npx -y @invariance/dna index
```

What gets written:

- `.cursor/rules/dna.mdc` — Cursor project rule with `alwaysApply: true`. Attached to every request.
- `.cursor/mcp.json` — adds `dna` to `mcpServers`. Existing entries are preserved (the file is JSON-merged).

## Walkthrough

In Cursor, open the agent chat and ask:

```
You: How do I add a $5000 cap to createRefund for non-enterprise customers?
```

Cursor will see the always-attached rule explaining that `dna prepare <symbol> --intent "<…>"` returns a decision-ready brief. Two surfaces are available — pick whichever fits the moment:

- **CLI**: `dna prepare createRefund --intent "add $5000 cap for non-enterprise"`
- **MCP**: call the `prepare_edit` tool with `{symbol: "createRefund", intent: "..."}`

The output includes structural context, tests, invariants, and notes from previous edits — before Cursor reads any file.

After the edit:

```bash
dna lessons record "non-enterprise caps live in pricing-config, not refunds"
```

## What the installer writes

### .cursor/rules/dna.mdc

```markdown
---
description: dna — local repo memory (symbol graph, tests, invariants, lessons, decisions). Use the CLI before non-trivial edits.
alwaysApply: true
---

# dna

<full agent instructions — see docs/guide/agents/cursor.md>
```

### .cursor/mcp.json

```json
{
  "mcpServers": {
    "dna": {
      "command": "npx",
      "args": ["-y", "@invariance/dna", "serve"]
    }
  }
}
```

If you already have other MCP servers in this file, they're preserved.

## Verifying

1. Cursor → Settings → MCP. The `dna` server should show a green dot.
2. Start a new chat. Ask about a real symbol. Cursor should run `dna prepare` or call `prepare_edit` before exploring.
3. If neither happens: Cursor sometimes caches rules — toggle the rule off and back on in Settings → Rules.

## Uninstall

Delete `.cursor/rules/dna.mdc` and remove the `dna` key from `mcpServers` in `.cursor/mcp.json`.
