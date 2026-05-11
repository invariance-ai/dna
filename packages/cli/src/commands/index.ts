import type { Command } from "commander";
import kleur from "kleur";
import {
  loadConfig,
  scanFiles,
  parseFile,
  buildIndex,
  writeIndex,
} from "@invariance/dna-core";
import { addRootOption, resolveRoot, type RootOption } from "../root.js";

export function registerIndex(program: Command): void {
  addRootOption(program
    .command("index")
    .description("Scan repo, build symbol graph, write .dna/index/symbols.json"))
    .action(async (opts: RootOption) => {
      const root = resolveRoot(opts);
      const t0 = Date.now();
      const config = await loadConfig(root);
      const files = await scanFiles(root, config);
      process.stdout.write(kleur.dim(`scanning ${files.length} files…`));
      const parsed = await Promise.all(files.map((f) => parseFile(f)));
      const index = buildIndex(root, parsed);
      await writeIndex(root, index);
      const ms = Date.now() - t0;
      process.stdout.write("\r" + " ".repeat(40) + "\r");
      console.log(
        kleur.green("indexed") +
          ` ${index.symbols.length} symbols, ${index.edges.length} edges across ${files.length} files in ${ms}ms`,
      );
    });
}
