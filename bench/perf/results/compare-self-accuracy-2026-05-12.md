# Compare-All: self

- Date: 2026-05-12T19:20:29.642Z
- Corpus root: `/Users/hardiksingh/CS/Projects/Invariance/dna/.claude/worktrees/dna-feature-observability`
- Sample size: 3
- Token estimation: chars / 4

## Side-by-side

| tool | tokens (mean) | tokens (p95) | ms p50 | ms p95 | ms mean | recall | callers | callees | tests |
|---|---|---|---|---|---|---|---|---|---|
| dna-brief | 154 (75% vs rg) | 211 | 200 | 218 | 204 | 100% | 100% | 100% | 100% |
| dna-full | 154 (75% vs rg) | 211 | 200 | 411 | 269 | — | — | — | — |
| rg | 624 (0% vs rg) | 827 | 12.7 | 13.9 | 12.6 | 89% | 100% | 67% | 100% |

## Notes

- `dna-brief` is the default mode (budget=1500); `dna-full` matches pre-PR behavior.
- `rg` bundle = `rg --json <symbol>` + `rg -A 5 -B 2 <symbol> | head -50` (what a no-tool agent would actually run).
- Recall is judged by `claude -p` extracting answers from each tool's output, scored against DNA's structural oracle (callers/callees) and DNA's testsForSymbol (tests). DNA's recall ceiling is therefore 1.0 by construction — the interesting numbers are whether rg/cmm can also recover those answers, and at what token cost.
