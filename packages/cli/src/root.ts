import path from "node:path";
import type { Command } from "commander";

export interface RootOption {
  root?: string;
}

export function resolveRoot(opts: RootOption): string {
  return path.resolve(opts.root ?? process.cwd());
}

export function addRootOption(command: Command): Command {
  return command.option("--root <path>", "Repo root (default: cwd)");
}
