/**
 * compare-verify — diff two verify-index JSON snapshots.
 *
 * Usage:
 *   tsx bench/perf/compare-verify.ts \
 *     --baseline bench/baselines/verify-index-self.json \
 *     --current /tmp/verify-current.json \
 *     [--md-out path] [--json-out path] \
 *     [--precision-fail 0.02] [--recall-warn 0.05] [--coverage-warn 0.05]
 *
 * Thresholds are absolute drops in the metric (e.g. 0.02 = 2 percentage
 * points). Exit code 0 unless a FAIL gate trips.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

interface VerifySnapshot {
  language: string;
  sample_size: number;
  total_edges: number;
  precision: number;
  precision_ci: { low: number; high: number };
  precision_confirmed: number;
  precision_contradicted: number;
  precision_inconclusive: number;
  recall: number;
  recall_ci: { low: number; high: number };
  recall_seen: number;
  recall_hit: number;
  coverage: number;
  thresholds?: { precision: number; recall: number; coverage: number };
  generated_at?: string;
}

interface Args {
  baseline: string;
  current: string;
  mdOut?: string;
  jsonOut?: string;
  precisionFail: number; // absolute drop, e.g. 0.02
  recallWarn: number;
  coverageWarn: number;
}

function parseArgs(argv: string[]): Args {
  const a = argv.slice(2);
  const out: Partial<Args> = {
    precisionFail: 0.02,
    recallWarn: 0.05,
    coverageWarn: 0.05,
  };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === "--baseline") out.baseline = a[++i];
    else if (k === "--current") out.current = a[++i];
    else if (k === "--md-out") out.mdOut = a[++i];
    else if (k === "--json-out") out.jsonOut = a[++i];
    else if (k === "--precision-fail") out.precisionFail = Number(a[++i]);
    else if (k === "--recall-warn") out.recallWarn = Number(a[++i]);
    else if (k === "--coverage-warn") out.coverageWarn = Number(a[++i]);
    else if (k === "--help" || k === "-h") {
      console.log("usage: compare-verify --baseline <p> --current <p> [--md-out <p>] [--json-out <p>] [--precision-fail 0.02] [--recall-warn 0.05] [--coverage-warn 0.05]");
      process.exit(0);
    }
  }
  if (!out.baseline || !out.current) {
    console.error("error: --baseline and --current are required");
    process.exit(2);
  }
  return out as Args;
}

async function load(p: string): Promise<VerifySnapshot> {
  return JSON.parse(await readFile(p, "utf8")) as VerifySnapshot;
}

function pp(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function fmtDeltaPp(x: number): string {
  const sign = x >= 0 ? "+" : "";
  return `${sign}${(x * 100).toFixed(2)}pp`;
}

interface Finding {
  metric: string;
  baseline: number;
  current: number;
  drop: number; // base - curr (positive == worse)
  threshold: number;
  level: "PASS" | "WARN" | "FAIL";
}

function compare(base: VerifySnapshot, curr: VerifySnapshot, args: Args): Finding[] {
  const findings: Finding[] = [];

  // precision: FAIL if drop > 2pp
  {
    const drop = base.precision - curr.precision;
    findings.push({
      metric: "precision",
      baseline: base.precision,
      current: curr.precision,
      drop,
      threshold: args.precisionFail,
      level: drop > args.precisionFail ? "FAIL" : "PASS",
    });
  }
  // recall: WARN if drop > 5pp
  {
    const drop = base.recall - curr.recall;
    findings.push({
      metric: "recall",
      baseline: base.recall,
      current: curr.recall,
      drop,
      threshold: args.recallWarn,
      level: drop > args.recallWarn ? "WARN" : "PASS",
    });
  }
  // coverage: WARN if drop > 5pp
  {
    const drop = base.coverage - curr.coverage;
    findings.push({
      metric: "coverage",
      baseline: base.coverage,
      current: curr.coverage,
      drop,
      threshold: args.coverageWarn,
      level: drop > args.coverageWarn ? "WARN" : "PASS",
    });
  }
  return findings;
}

function renderMarkdown(base: VerifySnapshot, curr: VerifySnapshot, findings: Finding[]): string {
  const L: string[] = [];
  L.push("## Verify-index gates");
  L.push("");
  L.push(`baseline sample=${base.sample_size}  current sample=${curr.sample_size}`);
  L.push("");
  L.push("| metric | baseline | current | Δ | threshold (drop) | level |");
  L.push("|---|---:|---:|---:|---:|:---:|");
  for (const f of findings) {
    const badge = f.level === "FAIL" ? "**FAIL**" : f.level === "WARN" ? "*WARN*" : "ok";
    L.push(
      `| ${f.metric} | ${pp(f.baseline)} | ${pp(f.current)} | ${fmtDeltaPp(-f.drop)} | ${fmtDeltaPp(f.threshold)} | ${badge} |`,
    );
  }
  const fails = findings.filter((f) => f.level === "FAIL").length;
  const warns = findings.filter((f) => f.level === "WARN").length;
  L.push("");
  L.push(
    fails > 0
      ? `**Result: FAIL** — ${fails} threshold breach(es), ${warns} warning(s).`
      : warns > 0
        ? `Result: PASS (with ${warns} warning(s)).`
        : `Result: PASS.`,
  );
  return L.join("\n") + "\n";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const base = await load(args.baseline);
  const curr = await load(args.current);
  const findings = compare(base, curr, args);
  const md = renderMarkdown(base, curr, findings);
  process.stdout.write(md);

  if (args.mdOut) {
    await mkdir(path.dirname(args.mdOut), { recursive: true });
    await writeFile(args.mdOut, md);
  }
  if (args.jsonOut) {
    await mkdir(path.dirname(args.jsonOut), { recursive: true });
    await writeFile(args.jsonOut, JSON.stringify({ findings, args }, null, 2) + "\n");
  }

  process.exit(findings.some((f) => f.level === "FAIL") ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
