import type { Command } from "commander";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import kleur from "kleur";
import { parse as parseYaml } from "yaml";
import { readIndex, verifyIndex, type VerifyReport } from "@invariance/dna-core";
import { addRootOption, resolveRoot, type RootOption } from "../root.js";

interface Opts extends RootOption {
  sample?: string;
  json?: boolean;
  noCache?: boolean;
}

interface Thresholds {
  precision: number;
  recall: number;
  coverage: number;
}

const DEFAULTS: Thresholds = { precision: 0.95, recall: 0.9, coverage: 0.85 };

async function loadThresholds(root: string): Promise<Thresholds> {
  try {
    const raw = await readFile(path.join(root, ".dna/config.yml"), "utf8");
    const data = parseYaml(raw) ?? {};
    const t = data?.quality?.thresholds ?? {};
    return {
      precision: t.precision ?? DEFAULTS.precision,
      recall: t.recall ?? DEFAULTS.recall,
      coverage: t.coverage ?? DEFAULTS.coverage,
    };
  } catch {
    return DEFAULTS;
  }
}

export function registerVerifyIndex(program: Command): void {
  addRootOption(
    program
      .command("verify-index")
      .description("Score DNA's symbol graph against TypeScript's type checker (precision/recall/coverage)")
      .option("--sample <n>", "Sampled edges & callsites (default 50)")
      .option("--no-cache", "Don't write the cached report")
      .option("--json", "Emit JSON instead of text"),
  ).action(async (opts: Opts) => {
    try {
      const root = resolveRoot(opts);
      const sample = opts.sample ? Number(opts.sample) : undefined;
      if (sample !== undefined && (!Number.isInteger(sample) || sample <= 0)) {
        throw new Error("--sample must be a positive integer");
      }
      const index = await readIndex(root);
      const thresholds = await loadThresholds(root);
      const report = await verifyIndex(index, { root, sample });

      if (!opts.noCache) {
        const cacheDir = path.join(root, ".dna/cache");
        await mkdir(cacheDir, { recursive: true });
        await writeFile(
          path.join(cacheDir, "verify-index.json"),
          JSON.stringify({ ...report, generated_at: new Date().toISOString(), thresholds }, null, 2),
        );
      }

      if (opts.json) {
        console.log(JSON.stringify({ ...report, thresholds }, null, 2));
      } else {
        renderReport(report, thresholds);
      }

      const passes =
        report.precision >= thresholds.precision &&
        report.recall >= thresholds.recall &&
        report.coverage >= thresholds.coverage;
      process.exitCode = passes ? 0 : 1;
    } catch (e) {
      console.error(kleur.red(`error: ${(e as Error).message}`));
      process.exitCode = 1;
    }
  });
}

function renderReport(r: VerifyReport, t: Thresholds): void {
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
  const badge = (ok: boolean): string => (ok ? kleur.green("✓") : kleur.red("✗"));
  console.log(kleur.bold("graph quality") + kleur.dim(`  (sample=${r.sample_size}/${r.total_edges} edges)`));
  console.log(`  ${badge(r.precision >= t.precision)} precision  ${pct(r.precision)}  ${kleur.dim(`(≥${pct(t.precision)})`)}`);
  console.log(`  ${badge(r.recall    >= t.recall)}    recall     ${pct(r.recall)}     ${kleur.dim(`(≥${pct(t.recall)})`)}`);
  console.log(`  ${badge(r.coverage  >= t.coverage)}  coverage   ${pct(r.coverage)}   ${kleur.dim(`(≥${pct(t.coverage)})`)}`);
  if (r.worst.length > 0) {
    console.log("\n" + kleur.bold("worst offenders"));
    for (const w of r.worst) {
      console.log(`  ${kleur.dim(w.from_file + ":" + w.from_line)}  ${w.callee}  ${kleur.yellow(w.issue)}`);
      if (w.dna_resolved_to) console.log(`    dna → ${kleur.dim(w.dna_resolved_to)}`);
      if (w.ts_resolved_to) console.log(`    ts  → ${kleur.dim(w.ts_resolved_to)}`);
    }
  }
}
