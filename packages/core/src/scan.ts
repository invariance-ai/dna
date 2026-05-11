import fg from "fast-glob";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { TS_GLOB, PY_GLOB } from "./parser.js";

export interface DnaConfig {
  languages: Array<"typescript" | "python">;
  exclude: string[];
  depth: number;
  strands: Array<"structural" | "tests" | "provenance" | "invariants">;
}

const DEFAULT_EXCLUDE = [
  "node_modules", "dist", "build", ".next", "out",
  "vendor", "__pycache__", ".venv", ".git", "coverage",
  ".dna",
];

export async function loadConfig(root: string): Promise<DnaConfig> {
  try {
    const raw = await readFile(path.join(root, ".dna/config.yml"), "utf8");
    const data = parseYaml(raw) ?? {};
    return {
      languages: data.languages ?? ["typescript", "python"],
      exclude: [...DEFAULT_EXCLUDE, ...(data.exclude ?? [])],
      depth: data.depth ?? 3,
      strands: data.strands ?? ["structural", "tests", "provenance", "invariants"],
    };
  } catch {
    return {
      languages: ["typescript", "python"],
      exclude: DEFAULT_EXCLUDE,
      depth: 3,
      strands: ["structural", "tests", "provenance", "invariants"],
    };
  }
}

export async function scanFiles(root: string, config: DnaConfig): Promise<string[]> {
  const patterns: string[] = [];
  if (config.languages.includes("typescript")) patterns.push(...TS_GLOB);
  if (config.languages.includes("python")) patterns.push(...PY_GLOB);
  const ignore = config.exclude.map((e) => `**/${e}/**`);
  const files = await fg(patterns, {
    cwd: root,
    ignore,
    absolute: true,
    dot: false,
    followSymbolicLinks: false,
  });
  return files;
}
