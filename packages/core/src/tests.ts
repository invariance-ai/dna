import type { TestRef } from "@invariance/dna-schemas";

/**
 * Discover test files and associate them with the symbols they exercise.
 * v0 heuristics:
 *   - co-located: foo.ts ↔ foo.test.ts / foo.spec.ts / test_foo.py
 *   - import-based: test file imports symbol X => covers X
 *   - description-based: test name mentions symbol X
 */
export async function discoverTests(_root: string): Promise<TestRef[]> {
  throw new Error("tests.discoverTests: not implemented");
}

export function testsForSymbol(symbol: string, all: TestRef[]): TestRef[] {
  return all.filter((t) => t.symbols_covered.includes(symbol));
}
