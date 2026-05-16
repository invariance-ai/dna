import type { Command } from "commander";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import kleur from "kleur";
import { stringify as yamlStringify } from "yaml";
import { seed, ALL_SOURCE_GLOBS } from "@invariance/dna-core";
import { addRootOption, resolveRoot, type RootOption } from "../root.js";

const CONFIG = `languages: [typescript, python]
exclude:
  - node_modules
  - dist
  - build
  - .next
  - vendor
  - __pycache__
  - .venv
depth: 3
strands:
  - structural
  - tests
  - provenance
  - invariants
`;

const INVARIANTS = `# .dna/invariants.yml — declarative constraints for symbols in your repo.
# Agents calling \`invariants_for(symbol)\` will receive matching rules with
# evidence *before* they edit, so they can avoid violating them.

- name: Example — high-value refunds require approval
  applies_to:
    - createRefund
    - "stripe.refunds.create"
  rule: Refunds over 1000 require finance_approval_id.
  evidence:
    - docs/refund-policy.md
  severity: block
`;

export interface InitOpts {
  force?: boolean;
}

export interface InitResult {
  writes: Array<{ action: "wrote" | "exists"; relPath: string }>;
}

export async function runInitCore(root: string, opts: InitOpts): Promise<InitResult> {
  const dnaDir = path.join(root, ".dna");
  await mkdir(dnaDir, { recursive: true });
  const writes: InitResult["writes"] = [];
  const targets: Array<[string, string]> = [
    [path.join(dnaDir, "config.yml"), CONFIG],
    [path.join(dnaDir, "invariants.yml"), INVARIANTS],
  ];
  for (const [p, content] of targets) {
    const rel = path.relative(root, p);
    if (!opts.force) {
      try {
        await access(p);
        writes.push({ action: "exists", relPath: rel });
        continue;
      } catch {
        /* doesn't exist, fall through */
      }
    }
    await writeFile(p, content);
    writes.push({ action: "wrote", relPath: rel });
  }
  return { writes };
}

type SeedTier = "safe" | "medium" | "aggressive";

const TIER_DEFAULTS: Record<SeedTier, { maxCommits: number; maxPrs: number; minConfidence: number; sources: Array<string> }> = {
  safe:       { maxCommits: 0,   maxPrs: 0,  minConfidence: 0.6, sources: ["todo"] },
  medium:     { maxCommits: 100, maxPrs: 20, minConfidence: 0.4, sources: ["todo", "commit", "pr"] },
  aggressive: { maxCommits: 500, maxPrs: 100, minConfidence: 0.2, sources: ["todo", "commit", "pr", "blame"] },
};

export async function seedCandidates(root: string, tier: SeedTier): Promise<{ count: number; path: string }> {
  const cfg = TIER_DEFAULTS[tier];
  const result = await seed(root, {
    maxCommits: cfg.maxCommits,
    maxPrs: cfg.maxPrs,
    scanFiles: ALL_SOURCE_GLOBS,
  });
  const filtered = result.proposals.filter(
    (p) => (p.confidence ?? 0) >= cfg.minConfidence && cfg.sources.includes(p.source),
  );
  const notes = filtered.filter((p) => p.kind === "note");
  const invariants = filtered.filter((p) => p.kind === "invariant");
  const dir = path.join(root, ".dna/candidates");
  await mkdir(dir, { recursive: true });
  const out = path.join(dir, "seed-" + new Date().toISOString().replace(/[:.]/g, "-") + ".yml");
  await writeFile(out, yamlStringify({
    tier,
    generated_at: new Date().toISOString(),
    scanned: result.scanned,
    notes,
    invariants,
  }));
  return { count: filtered.length, path: path.relative(root, out) };
}

export function registerInit(program: Command): void {
  addRootOption(
    program
      .command("init")
      .description("Initialize .dna/ in this directory (config + invariants)")
      .option("--force", "Overwrite existing files")
      .option("--seed [tier]", "Mine repo history for candidate notes/invariants (safe|medium|aggressive, default safe)"),
  ).action(async (opts: RootOption & { force?: boolean; seed?: boolean | string }) => {
    const root = resolveRoot(opts);
    const result = await runInitCore(root, { force: !!opts.force });
    for (const w of result.writes) {
      if (w.action === "wrote") console.log(kleur.green("wrote   ") + w.relPath);
      else console.log(kleur.dim(`exists  ${w.relPath}  (use --force to overwrite)`));
    }
    if (opts.seed) {
      const tier: SeedTier = typeof opts.seed === "string"
        ? (["safe", "medium", "aggressive"].includes(opts.seed) ? opts.seed as SeedTier : "safe")
        : "safe";
      console.log(kleur.dim(`\nmining seed candidates (tier=${tier})…`));
      const r = await seedCandidates(root, tier);
      console.log(kleur.green(`wrote   `) + r.path + kleur.dim(`  (${r.count} candidates)`));
      console.log(kleur.dim(`Next: review with \`dna seed review\` and promote with \`dna seed accept\`.`));
    }
    console.log("");
    console.log(`Next: ${kleur.bold("dna wizard")} to wire agents, or ${kleur.bold("dna index")} to build the symbol graph.`);
  });
}
