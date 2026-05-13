/**
 * Single source of truth for the agent-facing skill content that `dna install`
 * writes into target repos. Three IDE surfaces consume this:
 *
 *   - Claude Code → `.claude/skills/dna/SKILL.md` + appended block in `CLAUDE.md`
 *   - Codex CLI   → appended block in `AGENTS.md`
 *   - Cursor      → `.cursor/rules/dna.mdc`
 *
 * The shared body lives in SHARED_AGENT_BLOCK so a change to the dna CLI surface
 * only needs to be made once.
 */

const SHARED_AGENT_BLOCK = `\`dna\` is local repo memory: symbol graph, tests, invariants, lessons, decisions, and personal preferences. Hooks auto-fire dna on session start, on prompts, before/after edits, and on failures — you usually don't need to call dna by hand.

**Before editing a non-trivial symbol, call the MCP tool \`prepare_edit\` first** (it's exposed as \`mcp__dna__prepare_edit\` in Claude Code, or just \`prepare_edit\` in Cursor/Codex). The brief it returns — invariants, callers, tests, prior decisions — is what dna exists for; relying on Glob/Read/Grep alone is what dogfood measured as the +28% output / no quality-win path. Treat \`prepare_edit\` like a code-search call you make *before* exploration, not after.

Useful manual calls:

\`\`\`bash
dna find "<keyword>"               # locate existing helpers before writing new ones
dna context <symbol> --markdown    # plan a multi-file change
dna decisions <symbol>             # check prior choices before re-litigating
dna preferences                    # see the user's captured standing rules
dna prepare <symbol> --intent "…"  # decision-ready brief if the auto-context wasn't enough
\`\`\`

When the user gives a durable instruction ("from now on…", "always…", "i prefer…", "don't ever…"), the capture-preference hook records it automatically. Treat \`dna preferences\` output as soft constraints in every session.

When you learn something the next agent should know, persist it:
\`\`\`bash
dna lessons record "<one sentence>"          # auto-classified: global → CLAUDE.md; scoped → notes
dna lessons record "<…>" --hint-scope global # bias the classifier when it's wrong
dna lessons reclassify <id> --to <scope>     # move a lesson between tiers
dna learn <symbol> --lesson "<…>"            # legacy: always symbol-scoped
dna decide <symbol> --decision "<choice>" --rejected "<alternative>"
\`\`\`

\`dna lessons record\` returns the chosen scope and signals; if the scope looks wrong (e.g. it picked \`symbol\` for something repo-wide), call \`dna lessons reclassify <id> --to global\` to fix it. Global lessons land in the \`<!-- dna:global-lessons -->\` block of CLAUDE.md and are always loaded; scoped lessons live in \`.dna/notes/{symbol,file,feature}/\` and are auto-pulled when the prompt mentions the matching target.

**Tag the session early.** When you understand what the user is working on (e.g. "the homepage", "the auth flow"), call \`dna feature use <short-kebab-label>\` once. Use the exact label if the user names a known feature; otherwise pick a short kebab-case label. dna then learns which symbols belong to that feature and surfaces them automatically on future sessions that mention the same label.`;

/** Block appended to CLAUDE.md / AGENTS.md, bracketed by start/end markers. */
export const AGENT_INSTRUCTIONS = `<!-- dna:start -->
## dna

${SHARED_AGENT_BLOCK}
<!-- dna:end -->
`;

/** Standalone Claude Code skill written to `.claude/skills/dna/SKILL.md`. */
export const CLAUDE_SKILL = `---
name: dna
description: Use the dna CLI to fetch repo context, impact, tests, invariants, notes, and decisions before editing code.
---

# dna

Prefer the MCP tool surface in Claude Code: \`mcp__dna__prepare_edit\` returns
a decision-ready brief in one structured call and is cheaper than fanning out
to Glob/Read/Grep first. Fall back to the CLI when you're outside a tool
context (e.g. inside a Bash command):

\`\`\`text
mcp__dna__prepare_edit { "symbol": "<symbol>", "intent": "<short intent>" }
\`\`\`

CLI equivalent:

\`\`\`bash
dna prepare <symbol> --intent "<short intent>"
\`\`\`

Respect invariants marked \`block\`. Run tests listed by the prepare output or by:

\`\`\`bash
dna tests <symbol> --json
\`\`\`

Before creating a new helper, search for reusable code:

\`\`\`bash
dna find "<keyword>" --json
\`\`\`

After a successful edit, persist durable lessons:

\`\`\`bash
dna learn <symbol> --lesson "<one sentence>" --severity <low|medium|high>
dna decide <symbol> --decision "<choice>" --rejected "<alternative>"
\`\`\`
`;

/**
 * Cursor project rule. Cursor reads `.cursor/rules/*.mdc` files at session
 * start; `alwaysApply: true` makes this rule attach to every request without
 * the agent having to discover it.
 */
export const CURSOR_RULE = `---
description: dna — local repo memory (symbol graph, tests, invariants, lessons, decisions). Use the CLI before non-trivial edits.
alwaysApply: true
---

# dna

${SHARED_AGENT_BLOCK}

## When to reach for dna in Cursor

Cursor's agent runtime has shell access. Treat \`dna\` like \`rg\`: a local command you run before edits, not a service to call.

\`\`\`bash
dna prepare <symbol> --intent "<short intent>"   # decision-ready brief
dna tests <symbol> --json                        # tests that protect this symbol
dna find "<keyword>" --json                      # reusable helpers before writing new ones
\`\`\`

After a successful edit:

\`\`\`bash
dna lessons record "<one sentence>"              # persist what you learned
dna decide <symbol> --decision "<choice>" --rejected "<alternative>"
\`\`\`

The MCP server registered in \`.cursor/mcp.json\` exposes the same surface as a set of tools — use whichever interface (CLI or MCP) fits the moment.
`;
