import { createHash } from "node:crypto";

/**
 * Canonical symbol IDs designed to survive line movement.
 *
 * Legacy v0.1 id: `<file>#<qualified_name>:<line>` — changes whenever a
 * symbol moves down the file, which breaks anchors in notes/decisions.
 *
 * New stable id: `<file>#<qualified_name>@<hash>` where the hash is keyed
 * by `qualifiedName` (callers may pass a richer `body` if they want body-
 * sensitive anchors). With the default keying the id changes only on
 * rename / file move — exactly the anchor semantics #27 needs so that
 * refactors which shuffle lines don't invalidate notes/decisions.
 *
 * The line number is still carried on SymbolRef separately as a UI hint;
 * it is intentionally NOT part of the id.
 *
 * We keep the legacy format around as `legacySymbolId` so existing indexes,
 * notes, and tests keep working until callers opt in.
 */
export interface SymbolIdInput {
  file: string;
  qualifiedName: string;
  body?: string;
  line?: number;
}

export function stableSymbolId({ file, qualifiedName, body }: SymbolIdInput): string {
  const hash = shortHash(body ?? qualifiedName);
  return `${file}#${qualifiedName}@${hash}`;
}

export function legacySymbolId({ file, qualifiedName, line }: SymbolIdInput): string {
  return `${file}#${qualifiedName}:${line ?? 0}`;
}

export function shortHash(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 10);
}

const STABLE_ID_RE = /^(.+)#(.+)@([0-9a-f]{10})$/;
const LEGACY_ID_RE = /^(.+)#(.+):(\d+)$/;

export interface ParsedSymbolId {
  format: "stable" | "legacy";
  file: string;
  qualifiedName: string;
  hash?: string;
  line?: number;
}

export function parseSymbolId(id: string): ParsedSymbolId | undefined {
  const stable = STABLE_ID_RE.exec(id);
  if (stable) {
    return {
      format: "stable",
      file: stable[1]!,
      qualifiedName: stable[2]!,
      hash: stable[3]!,
    };
  }
  const legacy = LEGACY_ID_RE.exec(id);
  if (legacy) {
    return {
      format: "legacy",
      file: legacy[1]!,
      qualifiedName: legacy[2]!,
      line: Number(legacy[3]!),
    };
  }
  return undefined;
}
