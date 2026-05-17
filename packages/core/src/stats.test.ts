import { describe, expect, it } from "vitest";
import { wilson, formatWilsonPct } from "./stats.js";

describe("wilson", () => {
  it("returns [0,1] for n=0", () => {
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
  });
  it("brackets the point estimate", () => {
    const ci = wilson(7, 10);
    expect(ci.low).toBeGreaterThan(0.35);
    expect(ci.low).toBeLessThan(0.7);
    expect(ci.high).toBeGreaterThan(0.7);
    expect(ci.high).toBeLessThan(1);
  });
  it("does not exceed [0,1]", () => {
    const ci0 = wilson(0, 5);
    expect(ci0.low).toBe(0);
    expect(ci0.high).toBeGreaterThan(0);
    expect(ci0.high).toBeLessThan(1);
    const ci1 = wilson(5, 5);
    expect(ci1.high).toBe(1);
    expect(ci1.low).toBeGreaterThan(0);
    expect(ci1.low).toBeLessThan(1);
  });
  it("tightens as n grows", () => {
    const wide = wilson(2, 4);
    const narrow = wilson(100, 200);
    expect(narrow.high - narrow.low).toBeLessThan(wide.high - wide.low);
  });
});

describe("formatWilsonPct", () => {
  it("renders [lo, hi] as percentages", () => {
    expect(formatWilsonPct({ low: 0.69, high: 1.0 })).toBe("[69, 100]");
  });
  it("respects decimals arg", () => {
    expect(formatWilsonPct({ low: 0.123, high: 0.456 }, 1)).toBe("[12.3, 45.6]");
  });
});
