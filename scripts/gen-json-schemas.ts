#!/usr/bin/env tsx
/**
 * Generate JSON Schemas for `.dna/` files from the Zod definitions in
 * `@invariance/dna-schemas`. Run via `pnpm gen:schemas`. Editors and CI can
 * reference these via `$schema` to validate user-authored YAML/JSON.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  Invariant,
  Note,
  Decision,
  Preference,
  PrepareEditResult,
} from "../packages/schemas/src/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, "..", "packages", "schemas", "json");
const REPO = "https://github.com/invariance-ai/dna";

const Config = z
  .object({
    languages: z.array(z.enum(["typescript", "python", "javascript"])).default(["typescript"]),
    exclude: z.array(z.string()).default([]),
    depth: z.number().int().positive().default(3),
    strands: z
      .array(z.enum(["structural", "tests", "provenance", "invariants"]))
      .default(["structural", "tests", "provenance", "invariants"]),
  })
  .describe("dna repo configuration written to .dna/config.yml by `dna init`.");

const InvariantsFile = z
  .array(Invariant)
  .describe("Top-level array of invariants in .dna/invariants.yml.");

const targets: Array<{ name: string; schema: z.ZodTypeAny; title: string }> = [
  { name: "config", schema: Config, title: "dna config" },
  { name: "invariants", schema: InvariantsFile, title: "dna invariants" },
  { name: "invariant", schema: Invariant, title: "dna invariant (single)" },
  { name: "note", schema: Note, title: "dna note" },
  { name: "decision", schema: Decision, title: "dna decision" },
  { name: "preference", schema: Preference, title: "dna preference" },
  { name: "prepare-edit-result", schema: PrepareEditResult, title: "dna prepare_edit result (versioned)" },
];

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  for (const t of targets) {
    const json = zodToJsonSchema(t.schema, { name: t.title, target: "jsonSchema7" });
    const enriched = {
      $schema: "http://json-schema.org/draft-07/schema#",
      $id: `${REPO}/schemas/${t.name}.schema.json`,
      title: t.title,
      ...(json as Record<string, unknown>),
    };
    const file = path.join(OUT_DIR, `${t.name}.schema.json`);
    await writeFile(file, JSON.stringify(enriched, null, 2) + "\n");
    console.log(`wrote ${path.relative(process.cwd(), file)}`);
  }
}

main().catch((err: Error) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
