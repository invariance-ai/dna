# Using dna with a Python repo

dna's parser supports TypeScript, JavaScript, and Python today. The Python parser is regex-based (not tree-sitter / LSP yet), so accuracy is good for top-level functions/classes/methods and acceptable for everything else. This example walks through a Python repo and documents what works and what to expect.

## Install

```bash
cd your-python-repo
npx -y @invariance/dna init
# Edit .dna/config.yml so languages includes python:
#   languages: [python]
#   exclude: [__pycache__, .venv, venv, .pytest_cache, build, dist]
npx -y @invariance/dna install claude   # or codex, or cursor
npx -y @invariance/dna index
```

## Walkthrough

Pick a top-level function in your repo, e.g. `process_payment`:

```bash
dna find "process_payment" --json | head
dna context process_payment --markdown
dna tests process_payment
dna prepare process_payment --intent "add a retry on 429"
```

You should see:

- **Callers and callees** for top-level functions and class methods.
- **Tests** auto-discovered via pytest conventions (`tests/`, `test_*.py`, `*_test.py`).
- **Provenance** from `git log` over the symbol's file range.
- **Invariants** matching `process_payment` or qualified-name globs like `app.payments.*`.

## What works well

| Symbol kind | Detected |
|---|---|
| Module-level `def` | ✅ |
| Module-level `class` | ✅ |
| Methods on a class (incl. `@classmethod`, `@staticmethod`) | ✅ |
| Top-level constants assigned via `=` | ✅ |
| Type aliases (`Foo = TypedDict(...)`, `Foo: TypeAlias = ...`) | ✅ |

## What's accuracy-flagged today

- **Decorators that wrap and rename a function** (e.g. `functools.wraps` chains): the wrapped function is indexed; the decorator chain isn't fully resolved. You'll see the function, but `dna impact` may miss callers that import the decorator.
- **`__init__.py` re-exports** (`from .foo import bar`): followed one level. Chained re-exports are not.
- **Dynamic attribute access** (`getattr(obj, "method")`): not detected as a call edge.
- **Async generators / context managers**: detected as functions; the async/sync distinction isn't surfaced.

If accuracy bites, `dna trace <symbol>` falls back to `git log` and `dna find` falls back to ripgrep over the file body — neither depends on the parser.

## Recording lessons in a Python repo

```bash
dna lessons record "stripe SDK retries are baked in — don't wrap"
dna learn process_payment --lesson "amount must be in cents" --severity high
dna decide process_payment --decision "use idempotency_key from order_id" --rejected "generate uuid per call"
```

These persist exactly like in a TypeScript repo. The classifier doesn't care about language.

## When the parser misses something

Until tree-sitter lands (see [`docs/design-alternatives.md`](../../docs/design-alternatives.md)):

- Name the symbol by its definition site, not its re-export name.
- If `dna find` doesn't surface a symbol you know exists, add the file to `dna index`'s scan or check `.dna/config.yml` `exclude:`.
- File an issue with the snippet: <https://github.com/invariance-ai/dna/issues>.

## Roadmap

Tree-sitter WASM + LSP-backed reference resolution is the next accuracy step for Python (and TS/JS). Until then, the regex parser is a deliberate trade — zero native deps means dna installs cleanly via `npx` on any platform without compilation.
