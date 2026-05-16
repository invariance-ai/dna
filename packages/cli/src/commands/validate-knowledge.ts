import type { Command } from "commander";
import kleur from "kleur";
import { validateKnowledge } from "@invariance/dna-core";
import { addRootOption, resolveRoot, type RootOption } from "../root.js";

interface Opts extends RootOption {
  json?: boolean;
}

export function registerValidateKnowledge(program: Command): void {
  addRootOption(
    program
      .command("validate-knowledge")
      .description("Flag notes/decisions/invariants whose anchor symbols moved, vanished, or expired")
      .option("--json", "Emit JSON"),
  ).action(async (opts: Opts) => {
    const root = resolveRoot(opts);
    const report = await validateKnowledge(root);

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.issues.length > 0 ? 1 : 0;
      return;
    }

    const t = report.total;
    console.log(
      kleur.bold("validate-knowledge") +
        kleur.dim(`  ${t.notes} notes, ${t.decisions} decisions, ${t.invariants} invariants`),
    );
    if (report.issues.length === 0) {
      console.log(kleur.green("✓ all knowledge anchors valid"));
      return;
    }
    for (const i of report.issues) {
      const tag =
        i.kind === "expired"        ? kleur.yellow("EXPIRED      ") :
        i.kind === "missing_anchor" ? kleur.red("MISSING ANCHOR") :
                                       kleur.dim("NO ANCHOR ID  ");
      console.log(`  ${tag}  ${kleur.cyan(i.source)}  ${i.entry.symbol ?? "(no symbol)"} — ${kleur.dim(i.entry.summary)}`);
      if (i.suggested_anchor) {
        console.log(
          kleur.dim(`        → suggest re-anchor to ${i.suggested_anchor.qualified_name} (${i.suggested_anchor.file}, score ${i.suggested_anchor.score})`),
        );
      }
    }
    console.log(kleur.yellow(`\n${report.issues.length} issue(s)`));
    process.exitCode = 1;
  });
}
