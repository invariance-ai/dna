import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Command } from "commander";
import kleur from "kleur";
import {
  attributeFiles,
  clearActive,
  getActive,
  loadFeatures,
  mergeFeatures,
  normalizeLabel,
  renameFeature,
  setActive,
  topSymbols,
} from "@invariance/dna-core";
import { addRootOption, resolveRoot, type RootOption } from "../root.js";

const execFile = promisify(_execFile);

interface UseOpts extends RootOption {
  json?: boolean;
}

interface ListOpts extends RootOption {
  json?: boolean;
}

interface ShowOpts extends RootOption {
  limit: number;
  json?: boolean;
}

interface AttributeOpts extends RootOption {
  gitDiff?: boolean;
  files?: string[];
  action: string;
  feature?: string;
  json?: boolean;
}

interface RenameOpts extends RootOption {
  json?: boolean;
}

interface MergeOpts extends RootOption {
  json?: boolean;
}

interface ClearActiveOpts extends RootOption {
  json?: boolean;
}

export function registerFeature(program: Command): void {
  const feature = program
    .command("feature")
    .description("Named bags of symbols, learned by observing what the agent touches");

  addRootOption(
    feature
      .command("use <label...>")
      .description("Set the active feature for this session (the agent calls this once when it understands the user's intent)")
      .option("--json", "Emit JSON"),
  ).action(async (label: string[], opts: UseOpts) => {
    const root = resolveRoot(opts);
    const raw = label.join(" ");
    const result = await setActive(root, raw);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const verb = result.created ? "created" : "resumed";
    console.log(`${kleur.green(verb)} feature ${kleur.bold(result.label)}`);
  });

  addRootOption(
    feature
      .command("list")
      .description("List known features")
      .option("--json", "Emit JSON"),
  ).action(async (opts: ListOpts) => {
    const root = resolveRoot(opts);
    const features = await loadFeatures(root);
    const entries = Object.values(features.features).sort((a, b) =>
      a.last_active < b.last_active ? 1 : -1,
    );
    if (opts.json) {
      console.log(JSON.stringify({ features: entries }, null, 2));
      return;
    }
    if (entries.length === 0) {
      console.log(kleur.dim("no features yet — agents tag a session with `dna feature use <label>`"));
      return;
    }
    for (const f of entries) {
      console.log(
        `  ${kleur.bold(f.label)}  ${kleur.dim(`${f.symbols.length} symbols · ${f.sessions} sessions · last ${f.last_active.slice(0, 10)}`)}`,
      );
    }
  });

  addRootOption(
    feature
      .command("show <label>")
      .description("Top symbols for a feature")
      .option("--limit <n>", "Max symbols", (v) => parseInt(v, 10), 10)
      .option("--json", "Emit JSON"),
  ).action(async (label: string, opts: ShowOpts) => {
    const root = resolveRoot(opts);
    const top = await topSymbols(root, label, opts.limit);
    if (opts.json) {
      console.log(JSON.stringify({ label: normalizeLabel(label), symbols: top }, null, 2));
      return;
    }
    if (top.length === 0) {
      console.log(kleur.dim(`no symbols tracked yet for ${normalizeLabel(label)}`));
      return;
    }
    console.log(kleur.bold(normalizeLabel(label)));
    for (const s of top) {
      const w = s.weight.toFixed(2);
      console.log(`  ${kleur.dim(w)}  ${s.id}  ${kleur.dim(`(e${s.edits}/r${s.reads})`)}`);
    }
  });

  addRootOption(
    feature
      .command("attribute")
      .description("Bump symbol weights for touched files under the active feature (called by Stop hook)")
      .option("--git-diff", "Use `git diff --name-only HEAD` to determine touched files")
      .option("--files <files...>", "Explicit file list (overrides --git-diff)")
      .option("--action <a>", "edit | read", "edit")
      .option("--feature <label>", "Target feature (defaults to active)")
      .option("--json", "Emit JSON"),
  ).action(async (opts: AttributeOpts) => {
    const root = resolveRoot(opts);
    const action = opts.action === "read" ? "read" : "edit";

    let files: string[] = opts.files ?? [];
    if (files.length === 0 && opts.gitDiff) {
      files = await touchedFilesFromGit(root);
    }
    if (files.length === 0) {
      if (opts.json) console.log(JSON.stringify({ skipped: true, reason: "no files" }));
      return;
    }

    const result = await attributeFiles(root, files, action, opts.feature);
    if (!result) {
      if (opts.json) console.log(JSON.stringify({ skipped: true, reason: "no active feature" }));
      return;
    }
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(
      `${kleur.green("attributed")} ${result.touched_symbols} symbols to ${kleur.bold(result.label)} ${kleur.dim(`(${result.matched_files.length} files matched, ${result.unmatched_files.length} unmatched)`)}`,
    );
  });

  addRootOption(
    feature
      .command("rename <from> <to>")
      .description("Rename a feature (merges into destination if it already exists)")
      .option("--json", "Emit JSON"),
  ).action(async (from: string, to: string, opts: RenameOpts) => {
    const root = resolveRoot(opts);
    const ok = await renameFeature(root, from, to);
    if (opts.json) {
      console.log(JSON.stringify({ ok, from: normalizeLabel(from), to: normalizeLabel(to) }));
      return;
    }
    if (!ok) {
      console.log(kleur.yellow(`could not rename ${from} → ${to} (missing source or invalid)`));
      return;
    }
    console.log(`${kleur.green("renamed")} ${normalizeLabel(from)} → ${kleur.bold(normalizeLabel(to))}`);
  });

  addRootOption(
    feature
      .command("merge <from> <into>")
      .description("Merge one feature into another")
      .option("--json", "Emit JSON"),
  ).action(async (from: string, into: string, opts: MergeOpts) => {
    const root = resolveRoot(opts);
    const ok = await mergeFeatures(root, from, into);
    if (opts.json) {
      console.log(JSON.stringify({ ok, from: normalizeLabel(from), into: normalizeLabel(into) }));
      return;
    }
    if (!ok) {
      console.log(kleur.yellow(`could not merge ${from} → ${into}`));
      return;
    }
    console.log(`${kleur.green("merged")} ${normalizeLabel(from)} → ${kleur.bold(normalizeLabel(into))}`);
  });

  addRootOption(
    feature
      .command("clear-active")
      .description("Clear the active-feature pointer (called by SessionStart hook)")
      .option("--json", "Emit JSON"),
  ).action(async (opts: ClearActiveOpts) => {
    const root = resolveRoot(opts);
    await clearActive(root);
    if (opts.json) console.log(JSON.stringify({ ok: true }));
  });

  addRootOption(
    feature
      .command("active")
      .description("Print the active feature label, if any")
      .option("--json", "Emit JSON"),
  ).action(async (opts: ClearActiveOpts) => {
    const root = resolveRoot(opts);
    const label = await getActive(root);
    if (opts.json) {
      console.log(JSON.stringify({ active: label ?? null }));
      return;
    }
    if (label) console.log(label);
  });
}

async function touchedFilesFromGit(root: string): Promise<string[]> {
  const files = new Set<string>();
  for (const args of [
    ["diff", "--name-only", "HEAD"],
    ["diff", "--name-only", "--cached"],
    ["ls-files", "--others", "--exclude-standard"],
  ]) {
    try {
      const { stdout } = await execFile("git", args, { cwd: root, maxBuffer: 1024 * 1024 });
      for (const line of stdout.split("\n")) {
        const f = line.trim();
        if (f) files.add(f);
      }
    } catch {
      /* not a git repo or git unavailable — skip */
    }
  }
  return Array.from(files);
}

