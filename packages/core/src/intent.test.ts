import { describe, it, expect } from "vitest";
import { classifyIntent, excludeForIntent } from "./intent.js";

describe("classifyIntent", () => {
  it("detects PR intent", () => {
    expect(classifyIntent("write a PR for the refund fix")).toBe("pr");
    expect(classifyIntent("draft the PR description")).toBe("pr");
  });
  it("detects debug intent", () => {
    expect(classifyIntent("debugging the crash on null id")).toBe("debug");
    expect(classifyIntent("fixing a bug in createRefund")).toBe("debug");
  });
  it("detects review intent", () => {
    expect(classifyIntent("code review for the new endpoint")).toBe("review");
  });
  it("detects refactor intent", () => {
    expect(classifyIntent("refactor the auth middleware")).toBe("refactor");
  });
  it("falls back to edit/unknown", () => {
    expect(classifyIntent("(unspecified)")).toBe("unknown");
    expect(classifyIntent("change behavior to handle empty arrays")).toBe("edit");
    expect(classifyIntent("")).toBe("unknown");
  });
});

describe("excludeForIntent", () => {
  it("PR drops questions and notes", () => {
    const e = excludeForIntent("pr");
    expect(e.has("questions")).toBe(true);
    expect(e.has("notes")).toBe(true);
    expect(e.has("decisions")).toBe(false);
  });
  it("debug drops decisions only", () => {
    const e = excludeForIntent("debug");
    expect(e.has("decisions")).toBe(true);
    expect(e.has("notes")).toBe(false);
  });
  it("unknown excludes nothing", () => {
    expect(excludeForIntent("unknown").size).toBe(0);
  });
});
