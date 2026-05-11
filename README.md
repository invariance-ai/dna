# dna

> The repo that gets smarter every time you use it.

`dna` is **organizational memory with a code interface**. It gives Claude Code, Codex, Cursor — any coding agent — a compact, evidence-backed map of your repo before it changes code: symbols, callers and callees, tests that protect each function, recent git history, declarative invariants you author once ("refunds over $1000 require finance approval"), and **lessons learned from previous edits** that agents and humans persist as they go.

Three inputs compound on a single symbol graph:
1. **Static structure** — calls, callers, tests, provenance (the spine)
2. **Human intent** — notes, decisions, invariants (what's worth knowing)
3. **Agent behavior** *(v0.3)* — what they asked, what they broke (the signal)

Day one, dna is useful for context. Six months in, the notes-and-invariants layer is an asset every new engineer and every new agent depends on. Operational reality, encoded and made queryable. That's the thesis.

## Why this works where giant `CLAUDE.md` files don't

| Approach | KB size 10k | 50k | 200k |
|---|---|---|---|
| Global `CLAUDE.md` (always loaded) | 10k tok/turn | 50k tok/turn | impossible |
| Vector RAG over KB | 3-5k tok/turn | 3-5k tok/turn | lossy |
| **dna (anchored to symbols)** | **~300 tok/turn** | **~400 tok/turn** | **~600 tok/turn** |

dna only surfaces the slice attached to the symbol being edited. The graph does the retrieval; vectors aren't needed.

## Quickstart

No install required — `npx` runs the latest published version each time:

```bash
cd your-repo
npx -y @invariance/dna init                # writes .dna/config.yml + .dna/invariants.yml
npx -y @invariance/dna install claude      # writes CLAUDE.md + .claude skill/hooks
npx -y @invariance/dna install codex       # writes AGENTS.md + .codex/config.toml (notify + MCP)
npx -y @invariance/dna index               # builds the symbol graph
npx -y @invariance/dna learn-todos         # bootstrap notes from existing TODO/FIXME
```

Prefer a global install? `npm install -g @invariance/dna`, then drop the `npx -y` prefix and pass `--use-global` to the installers so the generated hooks call `dna` directly instead of `npx`.

## CLI

```bash
# Reading
dna prepare <symbol> --intent "what you'll change"   # ⭐ decision-ready brief
dna context <symbol>                                  # multi-strand context
dna impact <symbol>                                   # blast radius
dna tests <symbol>                                    # tests that protect it
dna invariants <symbol>                               # rules that apply
dna find "<query>"                                    # fuzzy symbol search
dna trace <symbol>                                    # git provenance

# Writing — anchored memory
dna learn <symbol> --lesson "..." [--severity low|medium|high] [--evidence <ref>]
dna notes <symbol>                                    # what previous edits left behind
dna learn-todos                                       # one-shot: lift TODO/FIXME into notes
dna decide <symbol> --decision "..." [--rejected "..."] [--rationale "..."]
dna decisions <symbol>                                # choices recorded, with rejected alternatives

# Server
dna index --watch                                     # rebuild on changes
dna serve                                             # MCP stdio server
dna serve --observe                                   # ⚡ opt-in: record per-symbol query counts (metadata only)
dna suggest                                           # surface symbols agents ask about repeatedly with no covering invariant
```

### Passive observer — opt-in, metadata only

`dna serve --observe` records *which symbol was queried* and *when*, into `.dna/observations.json`. **Nothing else.** No tool arguments beyond the symbol name, no tool results, no conversation content. The privacy line: dna never persists what an agent asked or what it received — only that `createRefund` was looked at 6 times this week.

`dna suggest` reads those counts and surfaces the symbols agents touch a lot that have no covering invariant. The agent's repeated confusion becomes the **authoring queue** — what's worth writing an invariant or note for next.

All read commands accept `--json` (stable contract for tool chaining) or `--markdown` (LLM-optimal). ANSI colors auto-strip when piped.

## Claude Code and Codex: CLI first

Claude Code and Codex agents already have Bash. Treat `dna` like `rg`: a local command the agent runs before and after edits. This is the primary integration surface.

For Claude Code, the installer wires four non-blocking hooks: `UserPromptSubmit` (auto-loads context for symbols named in your prompt), `PreToolUse` Edit/Write (refreshes the index), `PostToolUse` Bash (records failures against the last-prepared symbol), and `Stop` (distills the session into Decisions):

```bash
npx -y @invariance/dna install claude
```

For Codex CLI, the installer writes `AGENTS.md` instructions, registers `dna serve` as an MCP server, and configures a `notify` hook that distills each turn:

```bash
npx -y @invariance/dna install codex
```

For any other shell-based agent, add this to the repo instructions:

```text
You have access to `dna`, a CLI that returns structured repo context.

Before editing any non-trivial symbol, run:
  dna prepare <symbol> --intent "<one-line description>"

After a successful change that taught you something non-obvious, run:
  dna learn <symbol> --lesson "<one sentence>" --severity <low|medium|high>

To check what tests to run after editing:
  dna tests <symbol> --json
```

MCP is optional. `dna serve` exposes the same backend for tool-native clients, but the CLI is the surface to optimize first.

## Anchored memory in action

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

## Notes from previous edits
- **[high]** amount validation must happen before currency conversion
  - evidence: PR-1287
- **[medium]** wrap stripe.refunds.create in withRetry — flaky on Mondays
  - evidence: incident-2026-04-22

## Past decisions
- **validate amount before currency conversion**
  - rejected: validate after conversion (breaks for JPY)
  - rationale: $0.99 USD must not become 99 JPY

## Recent changes
- `a3f2c11` 2026-05-04 alex: added idempotency_key arg
```

The agent doesn't have to re-discover any of this. The lessons came from previous edits — recorded once, surfaced forever, only when relevant.

## Invariants

`dna` is the only OSS tool in its category that surfaces **author-defined invariants** alongside structural context.

```yaml
# .dna/invariants.yml
- name: High-value refunds require approval
  applies_to:
    - createRefund
    - "stripe.refunds.create"
  rule: Refunds over 1000 require finance_approval_id.
  evidence:
    - docs/refund-policy.md
  severity: block
```

Semgrep and CodeQL can match patterns, but they're security-first and not PM-authored. A YAML file with a rule, a link to the policy doc, and `severity: block` is a different artifact — one an LLM cannot reconstruct from a tree-sitter pass.

## Notes vs Invariants vs Decisions

Three artifact types, one symbol anchor:

| Artifact | Shape | Authored by | Promoted to |
|---|---|---|---|
| **Note** | a general lesson | anyone (agent, human, doc, TODO) | invariant (when patterns recur) |
| **Invariant** | a rule that must hold | PM / eng lead | — |
| **Decision** | a choice with rejected alternative | human / agent now, LLM-distilled from sessions later | — |

Notes "deflate" over time — recurring ones get promoted to invariants, and dna stops surfacing the note (the invariant strand picks it up instead). That's the asset-building mechanic.

## How it compares

| Tool | Returns | Notes / memory? | Invariants? | License |
|---|---|---|---|---|
| **dna** | Decision brief: structure + tests + invariants + **notes** + risk | **✅ anchored to symbols** | **✅ first-class** | MIT |
| Sverklo MCP | Ranked chunks + symbols | ❌ | ❌ | MIT |
| CodeGraph / CodeGraphContext / code-graph-mcp | Callers, callees, impact | ❌ | ❌ | OSS |
| Aider repomap | Token-budgeted symbol map | ❌ | ❌ | Apache-2 |
| Sourcegraph Cody | Files, symbols, refs | ❌ | ❌ | Commercial |
| Continue.dev | Chunks + repo map | ❌ | ❌ | Apache-2 |
| Greptile | Review comments | ❌ | ❌ | $20-30/seat |
| Nia / Nozomio | Vector chunks + 3000 packages | ❌ | ❌ | YC S25 |
| Cursor index | Embedded chunks | ❌ | ❌ | Closed |
| Semgrep / CodeQL | Pattern findings | ❌ | Pattern-based (security) | Mixed |

See [docs/competitive-landscape.md](docs/competitive-landscape.md) for the full survey, and [docs/simulated-benchmark.md](docs/simulated-benchmark.md) for first-cut benchmark estimates (~82% fewer exploration tokens, ~53% fewer regressions vs grep-only across 30 simulated tasks).

## Native-agent prompt commands

`dna` does not need to own the LLM runtime. For Claude Code and Codex, commands that need reasoning print a prompt package by default; the native agent answers using its own model/session, and `dna` records the resulting YAML or command.

```bash
# Propose an invariant from a regression PR (prints a native-agent prompt)
dna postmortem --pr 1287
dna postmortem --diff-file my.diff --symbol createRefund   # offline alternative

# Find clusters of similar notes that should become invariants
dna promote createRefund                            # rule-based, no API key needed

# Distill a conversation transcript into Decision records
dna attach --transcript path/to/transcript.txt --symbol createRefund --session "PR-1287"

# Extract Decision records from a PR's description, reviews, and comments
dna pr-intent --pr 1287
```

API execution is an explicit opt-in for automation: pass `--call-api` plus `ANTHROPIC_API_KEY` or `--api-key`. The default path is native Claude/Codex.

## Status

v0.2 (alpha). Working CLI + MCP. Ships structural context plus tests, provenance, invariants, notes, and decisions. The current index is a scoped symbol graph with stable symbol IDs, qualified names, file-aware call edges, and test-file tracking. It still uses a zero-native-deps regex parser for TS/JS/Python; tree-sitter WASM and LSP-backed reference resolution are the next accuracy step. Single-file JSON index — SQLite when repos push past ~500k LOC.

v0.3 roadmap: passive metadata observer (`dna observe` — symbol query frequencies only, never conversation content) + `dna suggest` for the invariant authoring queue + LLM-assisted postmortem promotion.

v0.4 roadmap: session anchoring (`dna attach --session`) — distill a Claude Code / Codex thread into structured `Decision` records attached to the symbols touched.

## License

MIT. Built by [Invariance](https://invariance.ai).
