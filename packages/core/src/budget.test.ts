import { describe, it, expect } from "vitest";
import { packByBudget, estimateTokens } from "./budget.js";

describe("packByBudget", () => {
  it("keeps everything when budget is unlimited", () => {
    const r = packByBudget(
      [
        { heading: "## A", items: ["- x", "- y"] },
        { heading: "## B", items: ["- z"] },
      ],
      0,
    );
    expect(r.text).toContain("## A");
    expect(r.text).toContain("## B");
    expect(r.text).toContain("- x");
    expect(r.text).toContain("- z");
    expect(r.dropped.filter((d) => d.reason === "budget")).toHaveLength(0);
  });

  it("drops later sections when budget is tight", () => {
    const big = "a".repeat(400); // ~100 tokens
    const r = packByBudget(
      [
        { heading: "## High", items: [`- ${big}`] },
        { heading: "## Low", items: [`- ${big}`] },
      ],
      120,
    );
    expect(r.text).toContain("## High");
    expect(r.text).not.toContain("## Low");
    expect(r.dropped.some((d) => d.section === "## Low" && d.reason === "budget")).toBe(true);
  });

  it("trims items within a section when partial fits", () => {
    const item = "- " + "a".repeat(40); // ~10 tokens
    const r = packByBudget(
      [{ heading: "## S", items: [item, item, item, item, item] }],
      35,
    );
    const kept = r.kept.find((k) => k.section === "## S");
    expect(kept).toBeTruthy();
    expect(kept!.items).toBeLessThan(5);
    expect(kept!.items).toBeGreaterThan(0);
  });

  it("skips empty sections without consuming budget", () => {
    const r = packByBudget(
      [
        { heading: "## Empty", items: [] },
        { heading: "## Real", items: ["- x"] },
      ],
      100,
    );
    expect(r.text).toContain("## Real");
    expect(r.text).not.toContain("## Empty");
    expect(r.dropped.some((d) => d.section === "## Empty" && d.reason === "empty")).toBe(true);
  });

  it("keeps trailing content for sections with no items", () => {
    const r = packByBudget(
      [
        {
          heading: "## Tests",
          items: [],
          trailing: "_no tests found_",
        },
      ],
      100,
    );
    expect(r.text).toContain("_no tests found_");
  });

  it("estimateTokens rounds up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});
