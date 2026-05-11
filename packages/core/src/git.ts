import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { ProvenanceEntry } from "@invariance/dna-schemas";

const execFile = promisify(_execFile);

export async function isGitRepo(root: string): Promise<boolean> {
  try {
    await execFile("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

export async function logForFile(
  root: string,
  relFile: string,
  limit = 5,
): Promise<ProvenanceEntry[]> {
  try {
    const { stdout } = await execFile(
      "git",
      ["log", `-n`, String(limit), "--format=%H%x09%an%x09%aI%x09%s", "--", relFile],
      { cwd: root, maxBuffer: 1024 * 1024 },
    );
    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [commit, author, date, ...msg] = line.split("\t");
        return {
          commit: (commit ?? "").slice(0, 7),
          author: author ?? "",
          date: date ?? "",
          message: msg.join("\t"),
        };
      });
  } catch {
    return [];
  }
}

export async function churn(root: string, relFile: string): Promise<number> {
  try {
    const { stdout } = await execFile(
      "git",
      ["log", "--oneline", "--", relFile],
      { cwd: root, maxBuffer: 1024 * 1024 },
    );
    return stdout.trim() ? stdout.trim().split("\n").length : 0;
  } catch {
    return 0;
  }
}

export function toRelativePath(root: string, abs: string): string {
  return path.relative(root, abs);
}
