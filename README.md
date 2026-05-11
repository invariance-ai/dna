# dna

> Codebase context for coding agents.

`dna` gives Claude Code, Codex, Cursor — any coding agent — a compact, evidence-backed map of your repo before it changes code. Symbols, callers and callees, tests that protect each function, recent git history, and **declarative invariants you author once** (e.g. "refunds over $1000 require finance approval"). Two surfaces, same backend: an **MCP server** for agents that call tools natively, and a **CLI** for agents that shell out via Bash (or for humans inspecting the same data). Backed by a single shared schema, so the surfaces cannot drift.

The thesis: structural call-graph context is now commodity (Sourcegraph, Aider repomap, Sverklo, CodeGraph, and ~8 other MCP servers all ship it). What still isn't is **invariants as a first-class agent-callable strand** — declarative rules with evidence pointers that say *what an agent must not break* before it touches a symbol. Pair that with a one-shot `prepare_edit` brief that combines structure + tests + invariants + risk, and the agent gets a decision-ready bundle, not a pile of chunks. That's the wedge `dna` is built around.

## Quickstart

```bash
npm install -g @invariance/dna
cd your-repo
dna init        # writes .dna/config.yml + .dna/invariants.yml
dna index       # builds the symbol graph (one JSON file under .dna/index/)
claude mcp add dna -- dna serve   # expose to Claude Code
```

## CLI

```bash
dna prepare <symbol> --intent "what you'll change"   # ⭐ decision-ready brief
dna context <symbol>                                  # multi-strand context
dna impact <symbol>                                   # blast radius
dna tests <symbol>                                    # tests that protect it
dna invariants <symbol>                               # rules that apply
dna find "<query>"                                    # fuzzy symbol search
dna trace <symbol>                                    # git provenance
dna index --watch                                     # rebuild on changes
dna serve                                             # MCP stdio server
```

All commands accept `--json` (stable contract for tool chaining) or `--markdown` (LLM-optimal). ANSI colors auto-strip when stdout isn't a TTY, so piped output is clean.

## For agents shelling out

Claude Code and Codex agents already have Bash. Tell them about `dna` and they can use it without any MCP wiring:

```text
You have access to `dna`, a CLI that returns structured repo context.
Before editing any non-trivial symbol, run:
  dna prepare <symbol> --intent "<one-line description>"

To check what tests to run after:
  dna tests <symbol> --json

To find existing helpers before adding new ones:
  dna find "<keyword>" --json
```

The MCP server (`dna serve`) is the same code path — pick whichever surface the agent works best in.

## What you get

```text
$ dna prepare createRefund --intent "add $5000 cap for non-enterprise"

# prepare_edit: createRefund

**Intent:** add $5000 cap for non-enterprise
**Defined in:** `apps/api/src/refunds.ts:42` (function)
**Risk:** HIGH

## Called by
- supportRefundWorkflow — apps/api/src/workflows.ts:88
- replayRefundCase — apps/api/src/replay.ts:14

## Tests to run after editing
- apps/api/src/refunds.test.ts (vitest)
- apps/api/src/refund-approval.test.ts (vitest)

## Invariants that apply
- **High-value refunds require approval** (block)
  Refunds over 1000 require finance_approval_id.
  evidence: docs/refund-policy.md

## Recent changes
- `a3f2c11` 2026-05-04 alex: added idempotency_key arg
```

## Invariants

`dna` is the only OSS tool in its category that surfaces **author-defined invariants** alongside structural context. Drop a `.dna/invariants.yml` in your repo:

```yaml
- name: High-value refunds require approval
  applies_to:
    - createRefund
    - "stripe.refunds.create"
  rule: Refunds over 1000 require finance_approval_id.
  evidence:
    - docs/refund-policy.md
  severity: block
```

When an agent calls `invariants_for("createRefund")` mid-task, it receives this rule with its evidence link, before it edits. Semgrep and CodeQL can match patterns, but they're security-first and not PM-authored. A YAML file with a rule, a link to the policy doc, and `severity: block` is a different artifact — one an LLM cannot reconstruct from a tree-sitter pass.

## How it compares

| Tool | Delivery | Approach | Returns | Invariants? | License |
|---|---|---|---|---|---|
| **dna** | MCP + CLI | tree-sitter graph + git + tests + invariants | Structured brief: structure / tests / invariants / risk | **✅ first-class** | MIT |
| Sverklo MCP | MCP + CLI | tree-sitter + BM25 + ONNX + PageRank | Ranked chunks + symbols | ❌ | MIT |
| CodeGraph | MCP | tree-sitter + SQLite + FTS | Callers, callees, impact, routes | ❌ | OSS |
| CodeGraphContext | MCP + CLI | tree-sitter + Neo4j/FalkorDB, 15 langs | Callers, callees, complexity | ❌ | OSS |
| code-graph-mcp | MCP | tree-sitter + SQLite + vec, RRF | Call graph, routes, impact, dead code | ❌ | OSS |
| Aider repomap | aider only | tree-sitter + PageRank | Token-budgeted symbol map | ❌ | Apache-2 |
| Sourcegraph Cody | IDE + MCP | LSIF/SCIP graph + remote search | Files, symbols, refs | ❌ | Commercial |
| Continue.dev | IDE plugin + MCP | embeddings + tree-sitter + SQL FTS | Chunks + repo map | ❌ | Apache-2 |
| Greptile | SaaS + API | Graph index, Claude Agent SDK reviews | Review comments | ❌ | $20-30/seat/mo |
| Nia / Nozomio | Hosted MCP | Vector RAG over repos + 3000+ packages | Chunks + doc passages | ❌ | Commercial (YC S25) |
| Cursor index | IDE-internal | AST → embeddings → Turbopuffer | Chunks injected into prompt | ❌ | Closed |
| Probe | MCP + CLI | ripgrep + tree-sitter | Whole AST blocks | ❌ | Apache-2 |
| Repo Prompt | Mac app + MCP | tree-sitter "Code Maps" | Token-optimized bundles | ❌ | Commercial |
| Semgrep | CLI + Skill | AST pattern rules | Rule findings | Pattern-based (security) | OSS + commercial |
| CodeQL | CLI + MCP wrappers | Semantic DB + QL queries | Dataflow paths | Pattern-based (security) | Free for OSS |

**Where `dna` wins:** evidence-backed, agent-callable invariants that a PM can author in YAML; one-shot `prepare_edit` bundle instead of chained retrieval calls; zero-native-deps install (no SQLite/Neo4j/ONNX runtime to ship).

**Where competitors win (today):** Sverklo has better raw retrieval quality on its 90-task bench; CodeGraphContext supports 15 languages vs `dna`'s 2 (TS + Python); Sourcegraph wins on enterprise multi-repo scale; Cursor wins on IDE integration depth.

See [docs/competitive-landscape.md](docs/competitive-landscape.md) for the full survey, and [docs/simulated-benchmark.md](docs/simulated-benchmark.md) for first-cut benchmark estimates.

## Status

v0.1 (alpha). Working CLI + MCP. Ships 4 context strands: **structural + tests + provenance + invariants**. Regex-based parser for TS/Python (tree-sitter WASM in v0.2). Storage is a single JSON file — SQLite lands when repos push past ~500k LOC.

v1 roadmap: runtime traces (OTel/Sentry/Datadog), data-layer awareness (which DB tables a symbol touches), cross-repo graphs, AI-assisted invariant authoring from PRs and docs.

## License

MIT. Built by [Invariance](https://invariance.ai).
