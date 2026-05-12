import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { CORPORA, ensureCorpus, type Corpus } from "./corpora.js";
import { indexCorpus } from "./run-index.js";
import { runQueries, runFiveQueryTask } from "./run-queries.js";
import { renderMarkdown, type CorpusReport } from "./report.js";

function parseArgs(argv: string[]): { corpora: string[]; out: string } {
  const args = argv.slice(2);
  let corpora: string[] = [];
  let out = "";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--corpus" || a === "-c") corpora.push(args[++i]);
    else if (a === "--out") out = args[++i];
    else if (a === "--all") corpora = Object.keys(CORPORA);
  }
  if (corpora.length === 0) corpora = ["flask"];
  if (!out) {
    const date = new Date().toISOString().slice(0, 10);
    out = path.join("bench/perf/results", `${date}.md`);
  }
  return { corpora, out };
}

async function main(): Promise<void> {
  const { corpora, out } = parseArgs(process.argv);
  const reports: CorpusReport[] = [];

  for (const name of corpora) {
    const c: Corpus | undefined = CORPORA[name];
    if (!c) {
      console.error(`unknown corpus: ${name}. known: ${Object.keys(CORPORA).join(", ")}`);
      process.exit(2);
    }
    console.log(`\n=== ${name} ===`);
    const root = await ensureCorpus(c);
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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
