# Using dna with Claude Code

```bash
npm install -g @invariance/dna
cd your-repo
dna init
claude mcp add dna -- dna serve
```

Now Claude Code will see four tools mid-task:

- `get_context(symbol)` — full multi-strand context before editing
- `impact_of(symbol)` — blast radius
- `tests_for(symbol)` — what to run after editing
- `invariants_for(symbol)` — rules to respect

Suggested system prompt addition:

```
Before editing any symbol, call dna.get_context(<symbol>) and
dna.invariants_for(<symbol>). Run dna.tests_for(<symbol>) after editing.
```
