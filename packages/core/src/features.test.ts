import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  attributeFiles,
  clearActive,
  getActive,
  loadFeatures,
  matchFeaturesInPrompt,
  mergeFeatures,
  normalizeLabel,
  renameFeature,
  setActive,
  topSymbols,
} from "./features.js";
import { writeIndex, type DnaIndex } from "./index_store.js";

const roots: string[] = [];

async function tempRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "dna-features-"));
  roots.push(root);
  return root;
}

async function seedIndex(root: string): Promise<void> {
  const index: DnaIndex = {
    version: 1,
    built_at: new Date().toISOString(),
    root,
    files: ["src/Home.tsx", "src/hooks/useHomeData.ts", "src/Other.ts"],
    symbols: [
      {
        id: "src/Home.tsx#HomeComponent:42",
        name: "HomeComponent",
        qualified_name: "HomeComponent",
        file: "src/Home.tsx",
        line: 42,
        kind: "function",
      },
      {
        id: "src/hooks/useHomeData.ts#useHomeData:8",
        name: "useHomeData",
        qualified_name: "useHomeData",
        file: "src/hooks/useHomeData.ts",
        line: 8,
        kind: "function",
      },
      {
        id: "src/Other.ts#Other:1",
        name: "Other",
        qualified_name: "Other",
        file: "src/Other.ts",
        line: 1,
        kind: "function",
      },
    ],
    edges: [],
  };
  await writeIndex(root, index);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("normalizeLabel", () => {
  it("lowercases, kebabs spaces/underscores, strips junk", () => {
    expect(normalizeLabel("Home Page")).toBe("home-page");
    expect(normalizeLabel("auth_flow")).toBe("auth-flow");
    expect(normalizeLabel("  Foo!! Bar  ")).toBe("foo-bar");
    expect(normalizeLabel("--billing--")).toBe("billing");
  });
});

describe("setActive + getActive", () => {
  it("creates a feature, bumps sessions, writes the pointer", async () => {
    const root = await tempRepo();
    const r1 = await setActive(root, "Home Page");
    expect(r1).toEqual({ label: "home-page", created: true });
    expect(await getActive(root)).toBe("home-page");

    const r2 = await setActive(root, "home-page");
    expect(r2).toEqual({ label: "home-page", created: false });

    const features = await loadFeatures(root);
    expect(features.features["home-page"]?.sessions).toBe(2);

    await clearActive(root);
    expect(await getActive(root)).toBeUndefined();
  });
});

describe("attributeFiles", () => {
  it("maps touched files to all top-level symbols and bumps weights/counters", async () => {
    const root = await tempRepo();
    await seedIndex(root);
    await setActive(root, "homepage");

    const r = await attributeFiles(root, ["src/Home.tsx", "src/hooks/useHomeData.ts"], "edit");
    expect(r?.touched_symbols).toBe(2);
    expect(r?.matched_files.sort()).toEqual(["src/Home.tsx", "src/hooks/useHomeData.ts"]);
    expect(r?.unmatched_files).toEqual([]);

    const top = await topSymbols(root, "homepage");
    expect(top.map((s) => s.id).sort()).toEqual([
      "src/Home.tsx#HomeComponent:42",
      "src/hooks/useHomeData.ts#useHomeData:8",
    ]);
    for (const s of top) {
      expect(s.weight).toBeGreaterThan(0);
      expect(s.edits).toBe(1);
      expect(s.reads).toBe(0);
    }
  });

  it("EWMA: repeated edits increase weight monotonically and saturate below 1", async () => {
    const root = await tempRepo();
    await seedIndex(root);
    await setActive(root, "homepage");
    let prev = 0;
    for (let i = 0; i < 8; i++) {
      await attributeFiles(root, ["src/Home.tsx"], "edit");
      const top = await topSymbols(root, "homepage", 1);
      const hot = top[0];
      expect(hot).toBeDefined();
      expect(hot!.weight).toBeGreaterThan(prev - 1e-9);
      expect(hot!.weight).toBeLessThanOrEqual(1);
      prev = hot!.weight;
    }
    expect(prev).toBeGreaterThan(0.6);
  });

  it("reads bump count but contribute less weight than edits", async () => {
    const root = await tempRepo();
    await seedIndex(root);
    await setActive(root, "homepage");
    await attributeFiles(root, ["src/Home.tsx"], "read");
    const afterRead = (await topSymbols(root, "homepage", 1))[0]!;
    expect(afterRead.reads).toBe(1);
    expect(afterRead.edits).toBe(0);
    const readWeight = afterRead.weight;

    await setActive(root, "auth");
    await attributeFiles(root, ["src/Home.tsx"], "edit");
    const afterEdit = (await topSymbols(root, "auth", 1))[0]!;
    expect(afterEdit.weight).toBeGreaterThan(readWeight);
  });

  it("returns undefined when no feature is active", async () => {
    const root = await tempRepo();
    await seedIndex(root);
    const r = await attributeFiles(root, ["src/Home.tsx"], "edit");
    expect(r).toBeUndefined();
  });

  it("collects unmatched files when not in the index", async () => {
    const root = await tempRepo();
    await seedIndex(root);
    await setActive(root, "homepage");
    const r = await attributeFiles(root, ["src/Home.tsx", "README.md"], "edit");
    expect(r?.matched_files).toEqual(["src/Home.tsx"]);
    expect(r?.unmatched_files).toEqual(["README.md"]);
  });
});

describe("matchFeaturesInPrompt", () => {
  it("matches labels and aliases case-insensitively with word boundaries", async () => {
    const root = await tempRepo();
    await setActive(root, "homepage");
    const features = (await loadFeatures(root)).features;
    features.homepage!.aliases = ["home page", "landing"];

    expect(matchFeaturesInPrompt("Work on the homepage banner", features)).toEqual(["homepage"]);
    expect(matchFeaturesInPrompt("fix the home page hero", features)).toEqual(["homepage"]);
    expect(matchFeaturesInPrompt("LANDING animation tweak", features)).toEqual(["homepage"]);
    // word-bounded: don't match inside another word
    expect(matchFeaturesInPrompt("homepageless variant", features)).toEqual([]);
  });
});

describe("renameFeature + mergeFeatures", () => {
  it("rename moves the feature and follows the active pointer", async () => {
    const root = await tempRepo();
    await seedIndex(root);
    await setActive(root, "homepage");
    await attributeFiles(root, ["src/Home.tsx"], "edit");
    expect(await renameFeature(root, "homepage", "home")).toBe(true);
    expect(await getActive(root)).toBe("home");
    const top = await topSymbols(root, "home", 5);
    expect(top.length).toBe(1);
  });

  it("merge combines symbols, preferring max weight and summing counts", async () => {
    const root = await tempRepo();
    await seedIndex(root);

    await setActive(root, "a");
    await attributeFiles(root, ["src/Home.tsx"], "edit");
    await attributeFiles(root, ["src/Home.tsx"], "edit");

    await setActive(root, "b");
    await attributeFiles(root, ["src/Home.tsx"], "edit");
    await attributeFiles(root, ["src/Other.ts"], "edit");

    expect(await mergeFeatures(root, "a", "b")).toBe(true);
    const features = await loadFeatures(root);
    expect(features.features.a).toBeUndefined();
    const merged = features.features.b!;
    expect(merged.symbols.length).toBe(2);
    const home = merged.symbols.find((s: { id: string }) => s.id.includes("Home.tsx"));
    expect(home?.edits).toBe(3);
  });
});
