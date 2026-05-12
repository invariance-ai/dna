# Troubleshooting

## Hooks aren't firing (Claude Code)

```bash
dna validate --root "$PWD"     # checks .claude/settings.json + index
```

If `validate` is happy but hooks still don't fire:

1. Confirm `.claude/settings.json` exists and contains `hooks.UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `Stop`.
2. Make sure Claude Code is reading project settings (`--setting-sources user,project,local`).
3. Run a hook manually: `npx -y @invariance/dna context-from-prompt --root "$PWD"`. If it errors here, the hook will silently no-op in Claude.

## Symbol not found

```bash
dna find "<keyword>" --json | head -20
```

The regex parser misses some patterns. Known gaps:

- **TypeScript class methods on default-exported classes** — sometimes attributed to the file, not the class.
- **Python decorators that wrap functions** — the wrapped function is indexed; the decorator is not.
- **Re-exports** (`export * from`) — followed one level only.

Tree-sitter and LSP-backed resolution are on the roadmap (see `docs/design-alternatives.md`). For now: name the symbol by its definition site, not its re-export name.

## "Cannot find module '@invariance/dna-core'"

You're in a fresh checkout with `node_modules` but no built packages.

```bash
pnpm install
pnpm -r build
```

The `dna` CLI consumes the built `dist/` from sibling workspace packages.

## MCP server won't connect (Codex / Cursor)

- **Codex:** check `.codex/config.toml` has the `[mcp_servers.dna]` block. The Codex CLI sometimes silently drops MCP servers if their command exits non-zero; run `dna serve` standalone to confirm it starts.
- **Cursor:** check `.cursor/mcp.json`. Cursor reloads MCP servers on file save — toggle off/on in Settings → MCP after editing.

## Lesson classified to the wrong scope

```bash
dna lessons list --json | head     # find the id
dna lessons reclassify <id> --to global    # or symbol / file / feature
```

The classifier learns from `--hint-scope` corrections; if you find yourself reclassifying the same shape of lesson, file a note: `dna learn dna.lessons --lesson "classifier misses pattern X"`.

## Hooks slow down sessions

The `PreToolUse` Edit/Write hook runs `dna index`, which is incremental but can take a few hundred ms on large repos. To diagnose:

```bash
time dna index --root "$PWD"
```

If it's over a second consistently, narrow `config.yml` `exclude:` to skip generated/vendored directories.

## Observations file growing fast

`dna serve --observe` writes to `.dna/observations.json` on every tool call. Add it to `.gitignore` and `dna observations rotate` (TODO — file an issue if this lands first) or just `rm` it occasionally; it rebuilds.

## Where to file issues

- GitHub: <https://github.com/invariance-ai/dna/issues>
- Include `dna --version`, `dna validate --root "$PWD" --json`, and the exact command that failed.
