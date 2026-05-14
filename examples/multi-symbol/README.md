# Multi-symbol refactor with dna

A walkthrough for the most common dna use case that the single-symbol `prepare` examples don't cover: a refactor that touches several related functions.

## Scenario

You're moving refund amount validation from a single function (`createRefund`) into a reusable helper that also gets called by `createPartialRefund` and `replayRefund`. Three symbols are in scope; some tests will need to be re-pointed.

## 1. Gather the impact

```bash
dna find "Refund" --json | head -20
dna impact createRefund                 # who calls createRefund?
dna context createRefund --markdown     # full strand: tests, invariants, notes, provenance
dna context createPartialRefund --markdown
dna context replayRefund --markdown
```

`dna impact` is the blast-radius pass — it tells you who else cares about a change. `dna context` is the depth pass for each individual symbol.

## 2. Prepare each call site

```bash
dna prepare createRefund --intent "extract amount validation into validateRefundAmount helper"
dna prepare createPartialRefund --intent "use shared validateRefundAmount"
dna prepare replayRefund --intent "use shared validateRefundAmount"
```

Each `prepare` is a decision-ready brief. Watch for:

- **Invariants marked `[block]`** — if any apply across all three, that's a sign the new helper has to enforce them.
- **Notes that contradict each other** — e.g. one note says "validate before currency conversion", another says "amount is already normalized when this is called". The new helper has to handle both pre-conditions or reject one.
- **Tests** — list all the test files. They likely need to be updated to either test the helper directly or to keep covering the call sites.

## 3. Check existing helpers first

```bash
dna find "validate" --json | head
dna find "amount" --json | head
```

dna's notes-and-invariants story doesn't help if a helper already exists. Always search before writing new code.

## 4. Make the changes

Standard agent workflow — Claude/Codex/Cursor edits the files. The dna hooks (in Claude) or `notify` (in Codex) run in the background; you don't have to think about them.

## 5. Persist the lessons that emerged

After the tests pass:

```bash
dna lessons record "validateRefundAmount is the canonical amount-validation helper; do not duplicate"
dna decide validateRefundAmount \
  --decision "validate before currency conversion" \
  --rejected "validate after conversion (breaks for JPY)" \
  --rationale "\$0.99 USD must not become 99 JPY"
```

The lesson auto-classifies. If it goes to symbol scope but should be global (every refund-related symbol should know), reclassify:

```bash
dna lessons list --json | grep validateRefundAmount
dna lessons reclassify <id> --to global
```

## 6. Promote, if a pattern emerged

If you wrote two similar lessons in this refactor — say, both "validate before conversion" *and* a previous "validate amount before retry" — `dna promote validateRefundAmount` clusters them and proposes an invariant for `.dna/invariants.yml`.

## What dna gives you for refactors specifically

| Without dna | With dna |
|---|---|
| Grep for callers; hope you got them all | `dna impact` lists callers, with edges |
| Re-read each call site to see what it expects | `dna context` shows tests, invariants, prior decisions |
| Tribal knowledge stays in heads | `dna learn` / `dna decide` / `dna lessons record` persists it |
| Same invariants get re-violated next quarter | `severity: block` invariants surface on every `prepare` |

This is the pattern that compounded into +11% answer quality on the [dogfood benchmark](../../bench/dogfood/2026-05-12-platform-tokens-quality.md). Refactors are where dna earns its keep.
