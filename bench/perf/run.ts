import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { CORPORA, ensureCorpus, type Corpus } from "./corpora.js";
import { indexCorpus } from "./run-index.js";
import { runQueries, runFiveQueryTask } from "./run-queries.js";
import { renderMarkdown, type CorpusReport } from "./report.js";

interface Args {
  corpora: string[];
  out: string;
  jsonOut: string;
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  let corpora: string[] = [];
  let out = "";
  let jsonOut = "";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--corpus" || a === "-c") corpora.push(args[++i]);
    else if (a === "--out") out = args[++i];
    else if (a === "--json") jsonOut = args[++i];
    else if (a === "--all") corpora = Object.keys(CORPORA);
  }
  if (corpora.length === 0) corpora = ["flask"];
  if (!out) {
    const date = new Date().toISOString().slice(0, 10);
    out = path.join("bench/perf/results", `${date}.md`);
  }
  return { corpora, out, jsonOut };
}

/**
 * Resolve a corpus name to a filesystem root.
 * `self` means "this repo" — handy for CI perf gates that don't want to
 * clone an external corpus on every PR.
 */
async function resolveRoot(name: string): Promise<string> {
  if (name === "self") return process.cwd();
  const c: Corpus | undefined = CORPORA[name];
  if (!c) {
    throw new Error(`unknown corpus: ${name}. known: self, ${Object.keys(CORPORA).join(", ")}`);
  }
  return ensureCorpus(c);
}

async function main(): Promise<void> {
  const { corpora, out, jsonOut } = parseArgs(process.argv);
  const reports: CorpusReport[] = [];

  for (const name of corpora) {
    console.log(`\n=== ${name} ===`);
    const root = await resolveRoot(name);
    console.log(`  corpus at ${root}`);

    console.log(`  indexing…`);
    const index = await indexCorpus(root);
    console.log(`    ${index.files} files, ${index.symbols} symbols, ${index.edges} edges in ${index.total_ms.toFixed(0)}ms`);

    console.log(`  querying…`);
    const queries = await runQueries(root, 15, 10);
    for (const q of queries) {
      console.log(`    ${q.tool.padEnd(12)} cold p50=${q.cold.p50.toFixed(2)}ms p95=${q.cold.p95.toFixed(2)}ms  warm p50=${q.warm.p50.toFixed(3)}ms p95=${q.warm.p95.toFixed(3)}ms  tokens≈${Math.round(q.tokens_mean)}`);
    }

    console.log(`  5-query task…`);
    const five = await runFiveQueryTask(root);
    console.log(`    ${five.total_tokens} tokens in ${five.total_ms.toFixed(1)}ms`);

    reports.push({ corpus: name, index, queries, five_query_tokens: five.total_tokens, five_query_ms: five.total_ms });
  }

  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, renderMarkdown(reports));
  console.log(`\nwrote ${out}`);

  if (jsonOut) {
    await mkdir(path.dirname(jsonOut), { recursive: true });
    const payload = {
      version: 1 as const,
      generated_at: new Date().toISOString(),
      node: process.version,
      corpora: reports.map((r) => ({
        corpus: r.corpus,
        index: r.index,
        queries: r.queries,
        five_query_tokens: r.five_query_tokens,
        five_query_ms: r.five_query_ms,
      })),
    };
    await writeFile(jsonOut, JSON.stringify(payload, null, 2) + "\n");
    console.log(`wrote ${jsonOut}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
