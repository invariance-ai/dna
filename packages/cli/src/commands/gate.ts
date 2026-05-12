import type { Command } from "commander";
import kleur from "kleur";
import { gate, type GateHit } from "@invariance/dna-core";
import { addRootOption, resolveRoot, type RootOption } from "../root.js";

interface GateOpts extends RootOption {
  diff?: boolean;
  base?: string;
  json?: boolean;
}

export function registerGate(program: Command): void {
  addRootOption(
    program
      .command("gate")
      .description("Fail when changed files touch blocking invariants (unless waived)")
      .option("--diff", "Gate the current working diff", false)
      .option("--base <ref>", "Diff base (default HEAD)", "HEAD")
      .option("--json", "Emit JSON"),
  ).action(async (opts: GateOpts) => {
    const root = resolveRoot(opts);
    const result = await gate(root, { base: opts.base });

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.blocking.length > 0 ? 1 : 0;
      return;
    }

    if (result.changed_files.length === 0) {
      console.log(kleur.dim("no changed files; nothing to gate"));
      return;
    }
    console.log(
      kleur.dim(`gating ${result.changed_files.length} file(s), ${result.changed_symbols.length} symbol(s) vs ${result.base}`),
    );
    if (result.hits.length === 0) {
      console.log(kleur.green("✓ no invariants apply to the diff"));
      return;
    }
    for (const h of result.hits) printHit(h);
    if (result.blocking.length > 0) {
      console.log(
        kleur.red(`\n✗ ${result.blocking.length} blocking invariant(s); waive with: dna waive <name> --reason <...>`),
      );
      process.exitCode = 1;
    } else {
      console.log(kleur.green(`\n✓ no blocking violations`));
    }
  });
}

function printHit(h: GateHit): void {
  const sev = h.invariant.severity;
  const tag =
    sev === "block" ? (h.waived ? kleur.yellow("WAIVED") : kleur.red("BLOCK")) :
    sev === "warn" ? kleur.yellow("WARN") : kleur.dim("INFO");
  console.log(`  ${tag}  ${kleur.cyan(h.invariant.name)} — ${h.invariant.rule}`);
  if (h.symbols.length) console.log(kleur.dim(`        symbols: ${h.symbols.slice(0, 5).join(", ")}${h.symbols.length > 5 ? "…" : ""}`));
  else if (h.files.length) console.log(kleur.dim(`        files: ${h.files.slice(0, 5).join(", ")}${h.files.length > 5 ? "…" : ""}`));
  if (h.waiver) console.log(kleur.dim(`        waiver: ${h.waiver.reason} (${h.waiver.at})`));
}
