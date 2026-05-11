# Using dna with Claude Code

Two ways to wire dna into Claude Code. Pick one.

## Option A — MCP (best for tool-native use)

```bash
npm install -g @invariance/dna
cd your-repo
dna init && dna index
claude mcp add dna -- dna serve
```

Claude Code now sees `prepare_edit`, `get_context`, `impact_of`, `tests_for`, `invariants_for`, `record_learning`, `notes_for`, and `find_reusable` as tools.

## Option B — CLI shell-out (zero config beyond install)

If you don't want to wire MCP, just drop this into your `CLAUDE.md`:

```text
You have access to `dna`, a CLI that returns structured repo context.

Before editing any non-trivial symbol, run:
  dna prepare <symbol> --intent "<one-line description>"

After a successful change that taught you something non-obvious, run:
  dna learn <symbol> --lesson "<one sentence>" --severity <low|medium|high>

To check what tests to run after editing:
  dna tests <symbol> --json
```

Same code path, no MCP server needed.

## Auto-connect: Skills + Hooks

For zero-prompt-engineering integration, drop these files into `.claude/` at your repo root. The skill teaches Claude *when* to call dna, and the hooks make it automatic.

### `.claude/skills/dna/SKILL.md`

```yaml
---
name: dna
description: Use dna to fetch repo context (symbols, callers, tests, invariants, lessons) before editing code, and to record lessons after.
---

# Using dna

When the user asks for a non-trivial edit to a symbol:

1. Run `dna prepare <symbol> --intent "<short>"` first. The output includes structure, tests, invariants, and notes from previous edits. **Respect any invariants marked `[block]`**.
2. Run the requested edit.
3. Run the tests listed under "Tests to run after editing".
4. If you discovered something non-obvious (a hidden caller, a subtle bug, a constraint), record it:
   `dna learn <symbol> --lesson "<one sentence>" --severity <low|medium|high>`

For broader change impact, use `dna impact <symbol>`. For finding existing helpers before adding new ones, use `dna find "<keyword>"`.
```

### `.claude/settings.json` (hooks)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "dna prepare \"$(jq -r .tool_input.file_path)\" --intent \"about to edit\" 2>/dev/null || true"
          }
        ]
      }
    ]
  }
}
```

This is a starter — tune `matcher` and the `dna prepare` argument extraction to your repo's symbol-resolution style. The `|| true` keeps the hook non-blocking.

For an **auto-learn** hook on Stop (record what was learned at end of task), see [`./hooks-autolearn.md`](./hooks-autolearn.md) — it's heavier (needs an LLM call to distill the lesson) and lands in dna v0.3 alongside the postmortem command.
