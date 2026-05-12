# Getting started

A 10-minute walkthrough: install dna in a real repo, see it surface context to an agent, then teach it something that sticks.

## 1. Install (1 min)

```bash
cd your-repo
npx -y @invariance/dna init
npx -y @invariance/dna install claude      # or `codex`, or `cursor`
npx -y @invariance/dna index
```

What just happened:

- `init` wrote `.dna/config.yml` (what to index) and `.dna/invariants.yml` (an example invariant you can delete).
- `install claude` wrote a `CLAUDE.md` block, a `.claude/skills/dna/SKILL.md` skill, and four non-blocking hooks in `.claude/settings.json`.
- `index` built the symbol graph at `.dna/index.json`. Re-runs are incremental.

If you prefer a global install: `npm install -g @invariance/dna`, then add `--use-global` to the install commands so hooks call `dna` directly instead of `npx`.

## 2. Look around (2 min)

```bash
dna find "<keyword>"             # fuzzy symbol search
dna context <symbol>             # multi-strand context (structure, tests, provenance, invariants)
dna impact <symbol>              # callers and blast radius
dna tests <symbol>               # tests that protect this symbol
```

Pick a real symbol from your repo and try each one. Every command accepts `--json` (machine-readable) or `--markdown` (LLM-readable).

## 3. Ask an agent something (3 min)

Open Claude Code in the repo and ask a question that mentions a symbol by name — for example:

> What does `createRefund` do, and what tests cover it?

The `UserPromptSubmit` hook fires `dna context-from-prompt`, which detects `createRefund` and injects its context strand before Claude reads any files. You should see Claude cite concrete line numbers and tests instead of grepping around.

## 4. Teach dna something (3 min)

After a real edit, persist what you learned:

```bash
dna lessons record "Wrap stripe.refunds.create in withRetry — flaky on Mondays"
```

dna auto-classifies the lesson:

- **global** lessons land in the `<!-- dna:global-lessons -->` block of `CLAUDE.md` (always loaded)
- **symbol-scoped** lessons land in `.dna/notes/symbol/<name>.json` (loaded only when that symbol is in context)

Wrong classification? `dna lessons reclassify <id> --to global`.

For invariants that should *block* future edits (e.g. policy rules), hand-edit `.dna/invariants.yml`:

```yaml
- name: High-value refunds require approval
  applies_to: [createRefund, "stripe.refunds.create"]
  rule: Refunds over 1000 require finance_approval_id.
  evidence: [docs/refund-policy.md]
  severity: block
```

Now the next time an agent runs `dna prepare createRefund`, this rule is in front of it.

## 5. See what agents are confused about (1 min)

```bash
dna serve --observe              # in a separate terminal, while an agent runs
dna suggest                      # symbols queried often with no covering invariant
```

`dna suggest` is your authoring queue — the symbols where the next invariant or note will have the most leverage.

## Next steps

- [`commands.md`](commands.md) — full CLI reference
- [`concepts.md`](concepts.md) — what symbols, strands, lessons, decisions, and preferences are
- [`files.md`](files.md) — what lives in `.dna/`
- [`agents/claude.md`](agents/claude.md), [`agents/codex.md`](agents/codex.md), [`agents/cursor.md`](agents/cursor.md) — per-IDE details
- [`troubleshooting.md`](troubleshooting.md) — common failures
