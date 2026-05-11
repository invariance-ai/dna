# dna

> Codebase context for coding agents.

`dna` gives Claude Code, Codex, Cursor, and any MCP-compatible agent a compact, evidence-backed map of your repo — symbols, impact, tests, and invariants — **before** they change code.

## Why

Coding agents are blind inside real repos. They edit `createRefund` without knowing it touches the `refunds` table, has a hidden caller in `replayRefundCase`, is protected by `refund-approval.test.ts`, and must enforce a "refunds over $1000 require finance approval" invariant.

Vector RAG returns chunks. Grep returns lines. `dna` returns **structure + tests + provenance + invariants** — the four things an agent needs to edit safely.

## Quickstart

```bash
npm install -g @invariance/dna
cd your-repo
dna init
claude mcp add dna -- dna serve
```

Now Claude Code can call `get_context`, `impact_of`, `tests_for`, and `invariants_for` mid-task.

## CLI

```bash
dna context createRefund      # full multi-strand context
dna impact createRefund       # blast radius
dna tests createRefund        # tests likely to cover this symbol
dna invariants createRefund   # constraints/evidence before editing
dna find "refund"             # fuzzy symbol search
dna trace createRefund        # who, when, last breaks
dna index --watch             # daemon mode
dna serve                     # MCP server (stdio)
dna bench                     # benchmark harness
```

## Example output

```text
$ dna context createRefund

Symbol: createRefund
Defined in: apps/api/src/refunds.ts:42

Calls:
  - stripe.refunds.create
  - requireFinanceApproval
  - emitFinding

Called by:
  - supportRefundWorkflow
  - replayRefundCase

Touches:
  - refunds (table)
  - findings (table)

Tests:
  - refund-approval.test.ts
  - customer-dry-run.test.ts

Invariants:
  - Refunds over $1000 require finance approval
  - Enterprise refunds require CSM review

Risk: High — edits affect monitor/finding generation
```

## Invariants

Drop a `.dna/invariants.yml` in your repo:

```yaml
- name: High-value refunds require approval
  applies_to:
    - createRefund
    - stripe.refunds.create
  rule: Refunds over 1000 require finance_approval_id.
  evidence:
    - docs/refund-policy.md
```

Agents calling `invariants_for("createRefund")` will receive this rule with its evidence, before they edit.

## Status

v0 (alpha). Ships 4 context strands: **structural + tests + provenance + invariants**. TypeScript + Python.

Runtime traces (OTel/Sentry/Datadog), data-layer analysis, and cross-repo graphs land in v1.

## License

MIT. Made by [Invariance](https://invariance.ai).
