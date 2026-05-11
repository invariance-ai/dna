import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { Invariant } from "@invariance/dna-schemas";

/**
 * Load `.dna/invariants.yml`. Tolerant of array-at-root or {invariants: [...]}.
 */
export async function loadInvariants(path: string): Promise<Invariant[]> {
  const raw = await readFile(path, "utf8");
  const data = parseYaml(raw);
  const items = Array.isArray(data) ? data : (data?.invariants ?? []);
  return items.map((i: unknown) => Invariant.parse(i));
}

export function invariantsFor(symbol: string, all: Invariant[]): Invariant[] {
  return all.filter((inv) => inv.applies_to.some((p) => matches(symbol, p)));
}

function matches(symbol: string, pattern: string): boolean {
  if (pattern === symbol) return true;
  if (pattern.endsWith("*")) return symbol.startsWith(pattern.slice(0, -1));
  return symbol.endsWith("." + pattern) || symbol.endsWith("/" + pattern);
}
