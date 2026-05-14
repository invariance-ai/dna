# Compare-All: self

- Date: 2026-05-12T20:57:01.006Z
- Corpus root: `/Users/hardiksingh/CS/Projects/Invariance/dna/.claude/worktrees/dna-feature-observability`
- Sample size: 10
- Token estimation: chars / 4

## Side-by-side

| tool | tokens (mean) | tokens (p95) | ms p50 | ms p95 | ms mean | recall | callers | callees | tests |
|---|---|---|---|---|---|---|---|---|---|
| dna-brief | 169 (78% vs rg) | 424 | 188 | 218 | 173 | — | — | — | — |
| dna-full | 201 (74% vs rg) | 535 | 190 | 375 | 188 | — | — | — | — |
| rg | 777 (0% vs rg) | 1380 | 12.3 | 29.4 | 13.9 | — | — | — | — |
| codebase-memory-mcp | 440 (43% vs rg) | 1177 | 6.85 | 7.66 | 6.94 | — | — | — | — |

## Notes

- `dna-brief` is the default mode (budget=1500); `dna-full` matches pre-PR behavior.
- `rg` bundle = `rg --json <symbol>` + `rg -A 5 -B 2 <symbol> | head -50` (what a no-tool agent would actually run).
- Recall is judged by `claude -p` extracting answers from each tool's output, scored against DNA's structural oracle (callers/callees) and DNA's testsForSymbol (tests). DNA's recall ceiling is therefore 1.0 by construction — the interesting numbers are whether rg/cmm can also recover those answers, and at what token cost.
