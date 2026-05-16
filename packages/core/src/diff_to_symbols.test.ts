import { describe, it, expect } from "vitest";
import { parseUnifiedDiff } from "./diff_to_symbols.js";

describe("parseUnifiedDiff", () => {
  it("parses single-file single-hunk diffs", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -10,3 +10,4 @@",
      " unchanged",
      "+added line",
      " unchanged",
      " unchanged",
    ].join("\n");
    const hunks = parseUnifiedDiff(diff);
    expect(hunks).toEqual([{ file: "src/a.ts", start_line: 10, end_line: 13 }]);
  });

  it("handles multiple hunks across files", () => {
    const diff = [
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -5,1 +5,2 @@",
      " x",
      "+new",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -20 +20,3 @@",
      " y",
    ].join("\n");
    const hunks = parseUnifiedDiff(diff);
    expect(hunks).toEqual([
      { file: "src/a.ts", start_line: 5, end_line: 6 },
      { file: "src/b.ts", start_line: 20, end_line: 22 },
    ]);
  });

  it("skips deletion-only hunks (+N,0)", () => {
    const diff = [
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -5,2 +5,0 @@",
      "-removed",
      "-removed",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual([]);
  });

  it("accepts --no-prefix diffs (no `b/` on +++ header)", () => {
    const diff = [
      "--- src/a.ts",
      "+++ src/a.ts",
      "@@ -10,3 +10,4 @@",
      " unchanged",
      "+added line",
    ].join("\n");
    const hunks = parseUnifiedDiff(diff);
    expect(hunks).toEqual([{ file: "src/a.ts", start_line: 10, end_line: 13 }]);
  });

  it("does not attribute hunks to /dev/null deletions", () => {
    const diff = [
      "--- a/src/a.ts",
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
      "-removed",
      "-removed",
      "-removed",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -5,1 +5,2 @@",
      " y",
      "+new",
    ].join("\n");
    const hunks = parseUnifiedDiff(diff);
    expect(hunks).toEqual([{ file: "src/b.ts", start_line: 5, end_line: 6 }]);
  });
});
