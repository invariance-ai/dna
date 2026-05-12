# Cursor

```bash
npx -y @invariance/dna install cursor
```

Writes:

- `.cursor/rules/dna.mdc` — Cursor project rule with `alwaysApply: true`. Attached to every request without the agent having to discover it.
- `.cursor/mcp.json` — registers `dna serve` as an MCP server. Merged with any existing entries you already have.

## What Cursor does with dna

The rule frontmatter:

```markdown
---
description: dna — local repo memory (symbol graph, tests, invariants, lessons, decisions). Use the CLI before non-trivial edits.
alwaysApply: true
---
```

The body teaches the agent the standard dna calls and explains that Cursor has shell access — `dna` is a CLI, not a service. The MCP server in `.cursor/mcp.json` exposes the same surface as a tool set; the agent picks whichever fits.

Cursor doesn't expose pre/post-tool-use hooks. Index refresh happens lazily when `dna prepare` or `dna context` runs.

## Verifying it's working

1. In Cursor: Settings → MCP. The `dna` server should show as connected (green dot).
2. Start a new chat in the repo. Ask: *"What does `<some-symbol>` do?"*. The agent should run `dna prepare` or call the `prepare_edit` MCP tool before answering.
3. If the rule isn't being applied: check `.cursor/rules/dna.mdc` exists and has `alwaysApply: true` in the frontmatter.

## Customizing

- **Skip the MCP entry** (rule file only): `dna install cursor --skip-mcp`.
- **Use global binary**: `dna install cursor --use-global`.
- **Force overwrite**: `dna install cursor --force`.

## Uninstalling

Delete `.cursor/rules/dna.mdc` and remove the `dna` key from `mcpServers` in `.cursor/mcp.json`.
