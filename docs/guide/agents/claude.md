# Claude Code

```bash
npx -y @invariance/dna install claude
```

Writes:

- `CLAUDE.md` — appends a `<!-- dna:start -->...<!-- dna:end -->` block with manual call instructions and standing-rules guidance. Idempotent: re-runs replace the block.
- `.claude/skills/dna/SKILL.md` — the dna skill. Claude Code auto-loads it.
- `.claude/settings.json` — five non-blocking hooks. See below.

## The five hooks

| Hook | When | What it does |
|---|---|---|
| `SessionStart` (startup\|resume) | Session opens | `dna index` (rebuild graph), `dna feature clear-active`, `dna session start`, print `dna preferences --markdown` |
| `UserPromptSubmit` | Every prompt | `dna capture-preference --emit` (catches "from now on…" rules), `dna context-from-prompt` (auto-inject context for named symbols) |
| `PreToolUse` Edit\|MultiEdit\|Write | Before any edit | `dna index` — keep graph fresh |
| `PostToolUse` Bash | After every Bash | If exit code ≠ 0, `dna record-failure --kind bash` against the last-prepared symbol |
| `Stop` | Turn end | `dna attach --transcript -` (distill session into Decisions), `dna feature attribute --git-diff` (only if `dna validate` passes — stale graphs poison attribution), `dna session end` |

All hooks pipe to `>/dev/null 2>&1 || true`. A broken hook never breaks the agent.

## What Claude does with dna

The injected `CLAUDE.md` block teaches Claude:

- Run `dna find` before writing a new helper.
- Run `dna context <symbol> --markdown` to plan a multi-file change.
- Run `dna decisions <symbol>` to check prior choices before re-litigating.
- Treat `dna preferences` output as soft constraints.
- Tag the session early with `dna feature use <label>`.
- Persist lessons with `dna lessons record` and decisions with `dna decide`.

## Verifying it's working

```bash
dna validate --root "$PWD"
```

Then in a Claude Code session:

```
You: What does createRefund do?
```

You should see Claude reference concrete line numbers and tests in its first response — that's `context-from-prompt` injecting the symbol's strands before Claude reads any files.

## Customizing

- **Skip the CLAUDE.md append**: `dna install claude --skip-claude-md`.
- **Use global binary instead of npx**: `npm install -g @invariance/dna && dna install claude --use-global`.
- **Force overwrite of managed files**: `dna install claude --force`.

## Uninstalling

Delete the `.claude/skills/dna/` directory, remove the `<!-- dna:start -->...<!-- dna:end -->` block from `CLAUDE.md`, and clear `hooks` from `.claude/settings.json`.
