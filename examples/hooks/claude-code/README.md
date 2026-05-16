# DNA hooks for Claude Code

Drop `settings.json` into `.claude/settings.local.json` (project-local) or
`~/.claude/settings.json` (user-global) to turn DNA into an active edit guard:

- **PostToolUse** (after Edit / Write / MultiEdit): runs `dna gate --changed`.
  Maps the just-edited hunks to symbols, flags any invariant violations the
  agent introduced. JSON is read by the next tool call's context.
- **Stop**: runs `dna review-diff` as a final check before the agent signs off.
  Catches anything that slipped through.

Prerequisite: `dna` on `$PATH`, a built `.dna/index/`, and at least one
invariant in `.dna/invariants.yml`. Run `dna init` if you don't have these.

Pair with `dna gate --watch` in a separate terminal if you want a streaming
view: violations append to `.dna/cache/gate-stream.jsonl` and the agent can
poll them via the `gate_stream` MCP tool.
