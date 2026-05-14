# Using dna with Codex CLI

Codex CLI doesn't have pre-tool-use hooks like Claude Code, but it does support `notify` and MCP servers. dna registers both.

## Install

```bash
cd your-repo
npx -y @invariance/dna init
npx -y @invariance/dna install codex
npx -y @invariance/dna index
```

What gets written:

- `AGENTS.md` — appends a `<!-- dna:start -->...<!-- dna:end -->` block. Codex reads this on every session.
- `.codex/config.toml` — appends a `# dna:start ... # dna:end` block with:
  - `notify = ["npx", "-y", "@invariance/dna", "attach", "--transcript", "-"]` — turn-end transcript distillation
  - `[mcp_servers.dna]` registering `dna serve` as an MCP server

## Walkthrough

Open a Codex session in the repo. Try:

```
You: Walk me through what createRefund does and what tests cover it.
```

Codex will see the `AGENTS.md` block telling it to run `dna context` or call the `get_context` MCP tool before exploring. You should see it cite concrete line numbers and a test file in its first response.

After the edit:

```bash
dna lessons record "amount validation must happen before currency conversion"
```

The Codex `notify` hook fires `dna attach --transcript -` at turn end, distilling the conversation into Decision records anchored to the symbols touched.

## Verifying

```bash
dna serve   # confirms the MCP server starts cleanly; Ctrl-C to exit
dna validate --root "$PWD"
```

## What the installer writes

### AGENTS.md block

Same content as the Claude `CLAUDE.md` block — call patterns for `find`, `context`, `prepare`, `lessons record`, `decide`. See [`docs/guide/agents/codex.md`](../../docs/guide/agents/codex.md) for the full content.

### .codex/config.toml block

```toml
# dna:start — managed by `dna install codex`. Edit outside markers freely.
notify = ["npx", "-y", "@invariance/dna", "attach", "--transcript", "-"]

[mcp_servers.dna]
command = "npx"
args = ["-y", "@invariance/dna", "serve"]
# dna:end
```

`# dna:start` / `# dna:end` markers mean re-running `dna install codex` replaces the managed block without touching anything outside it.

## Uninstall

Remove the `# dna:start ... # dna:end` block from `.codex/config.toml` and the `<!-- dna:start -->...<!-- dna:end -->` block from `AGENTS.md`.
