import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(_execFile);

/**
 * Shells out to the `gh` CLI. Returns null when gh is unavailable or the
 * call fails — callers fall back to `--diff-file` etc.
 */
export interface PrSnapshot {
  number: number;
  title: string;
  body: string;
  diff: string;
  files: string[];
}

export async function ghAvailable(): Promise<boolean> {
  try {
    await execFile("gh", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

export async function fetchPr(prNumber: number | string): Promise<PrSnapshot | null> {
  if (!(await ghAvailable())) return null;
  try {
    const { stdout: meta } = await execFile(
      "gh",
      ["pr", "view", String(prNumber), "--json", "number,title,body,files"],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    const m = JSON.parse(meta) as {
      number: number;
      title: string;
      body: string;
      files: Array<{ path: string }>;
    };
    const { stdout: diff } = await execFile("gh", ["pr", "diff", String(prNumber)], {
      maxBuffer: 16 * 1024 * 1024,
    });
    return {
      number: m.number,
      title: m.title,
      body: m.body ?? "",
      diff,
      files: m.files.map((f) => f.path),
    };
  } catch {
    return null;
  }
}
