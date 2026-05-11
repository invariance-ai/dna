import type { Command } from "commander";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import kleur from "kleur";
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

export function registerInit(program: Command): void {
  addRootOption(
    program
      .command("init")
      .description("Initialize .dna/ in this directory (config + invariants)")
      .option("--force", "Overwrite existing files"),
  ).action(async (opts: RootOption & { force?: boolean }) => {
    const root = resolveRoot(opts);
    const result = await runInitCore(root, { force: !!opts.force });
    for (const w of result.writes) {
      if (w.action === "wrote") console.log(kleur.green("wrote   ") + w.relPath);
      else console.log(kleur.dim(`exists  ${w.relPath}  (use --force to overwrite)`));
    }
    console.log("");
    console.log(`Next: ${kleur.bold("dna wizard")} to wire agents, or ${kleur.bold("dna index")} to build the symbol graph.`);
  });
}
