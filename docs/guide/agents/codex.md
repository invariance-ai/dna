# Codex CLI

```bash
npx -y @invariance/dna install codex
```

Writes:

- `AGENTS.md` — appends a `<!-- dna:start -->...<!-- dna:end -->` block. Codex reads this at session start.
- `.codex/config.toml` — appends a `# dna:start ... # dna:end` managed block with two entries:
  - `notify = ["npx", "-y", "@invariance/dna", "attach", "--transcript", "-"]` — turn-end hook that distills the transcript into Decisions
  - `[mcp_servers.dna]` — registers `dna serve` as an MCP server

The Codex CLI does not expose pre-tool-use hooks, so the index is refreshed lazily by `dna prepare` and `dna context` calls. Treat `dna` like `rg`: a local CLI Codex runs before non-trivial edits.

## What Codex does with dna

The `AGENTS.md` block teaches Codex the same calls as Claude:

```bash
dna find "<keyword>"
dna context <symbol> --markdown
dna prepare <symbol> --intent "<…>"
dna lessons record "<…>"
dna decide <symbol> --decision "<…>" --rejected "<…>"
```

The MCP server exposes the same surface as tools (see [`docs/guide/commands.md`](../commands.md) for the full list).

## Verifying it's working

Run `dna serve` standalone to confirm the MCP server starts cleanly:

```bash
dna serve
# (waits on stdio; Ctrl-C to exit)
```

If Codex's notify hook isn't firing, check that `notify` lives inside the top-level table of `.codex/config.toml` (not nested under a `[section]`). The installer writes it correctly; manual edits sometimes accidentally nest it.

## Customizing

- **Skip the AGENTS.md append**: `dna install codex --skip-agents-md`.
- **Use global binary**: `dna install codex --use-global`.
- **Force overwrite**: `dna install codex --force`.

## Uninstalling

Remove the `<!-- dna:start -->...<!-- dna:end -->` block from `AGENTS.md` and the `# dna:start ... # dna:end` block from `.codex/config.toml`.
