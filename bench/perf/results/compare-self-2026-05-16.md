# Compare-All: self

- Date: 2026-05-16T20:06:43.821Z
- Corpus root: `/Users/hardiksingh/CS/Projects/Invariance/dna/.claude/worktrees/dna-feature-observability`
- Sample size: 10
- Token estimation: chars / 4

## Side-by-side

| tool | tokens (mean) | tokens (p95) | ms p50 | ms p95 | ms mean | recall | callers | callees | tests |
|---|---|---|---|---|---|---|---|---|---|
| dna-brief | 129 (88% vs rg) | 286 | 562 | 778 | 471 | — | — | — | — |
| dna-full | 183 (83% vs rg) | 341 | 419 | 1200 | 429 | — | — | — | — |
| rg | 1080 (0% vs rg) | 3120 | 61.2 | 191 | 64.1 | — | — | — | — |

## Notes

- `dna-brief` is the default mode (budget=1500); `dna-full` matches pre-PR behavior.
- `rg` bundle = `rg --json <symbol>` + `rg -A 5 -B 2 <symbol> | head -50` (what a no-tool agent would actually run).
- Recall is judged by `claude -p` extracting answers from each tool's output, scored against DNA's structural oracle (callers/callees) and DNA's testsForSymbol (tests). DNA's recall ceiling is therefore 1.0 by construction — the interesting numbers are whether rg/cmm can also recover those answers, and at what token cost.
