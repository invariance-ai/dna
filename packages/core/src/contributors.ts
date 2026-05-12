import { loadDecisions } from "./decisions.js";
import { logForFile, isGitRepo } from "./git.js";
import { open as openQuery, resolveSymbol } from "./query.js";

export interface ContributorEntry {
  name: string;
  score: number;
  commits: number;
  decisions: number;
}

/**
 * Aggregate authorship signal for a symbol. Score is a weighted blend:
 *   0.7 * commit_share + 0.3 * decision_share
 * (notes have no author field today — added back to the blend when it lands.)
 */
export async function rankContributors(
  root: string,
  symbolQuery: string,
): Promise<ContributorEntry[]> {
  const ctx = await openQuery(root);
  const sym = resolveSymbol(symbolQuery, ctx);
  if (!sym) return [];
  const symbolKey = sym.qualified_name ?? sym.name;

  const commitsByAuthor = new Map<string, number>();
  if (await isGitRepo(root)) {
    try {
      const log = await logForFile(root, sym.file, 200);
      for (const e of log) {
        commitsByAuthor.set(e.author, (commitsByAuthor.get(e.author) ?? 0) + 1);
      }
    } catch {
      /* ignore git errors */
    }
  }

  const decisions = await loadDecisions(root, symbolKey);
  const decisionsByAuthor = new Map<string, number>();
  for (const d of decisions) {
    const a = d.made_by;
    if (!a) continue;
    decisionsByAuthor.set(a, (decisionsByAuthor.get(a) ?? 0) + 1);
  }

  const totalCommits = [...commitsByAuthor.values()].reduce((s, v) => s + v, 0);
  const totalDecisions = [...decisionsByAuthor.values()].reduce((s, v) => s + v, 0);

  const names = new Set<string>([...commitsByAuthor.keys(), ...decisionsByAuthor.keys()]);
  const out: ContributorEntry[] = [];
  for (const name of names) {
    const commits = commitsByAuthor.get(name) ?? 0;
    const decisionCount = decisionsByAuthor.get(name) ?? 0;
    const commitShare = totalCommits > 0 ? commits / totalCommits : 0;
    const decisionShare = totalDecisions > 0 ? decisionCount / totalDecisions : 0;
    const score = 0.7 * commitShare + 0.3 * decisionShare;
    out.push({ name, score, commits, decisions: decisionCount });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}
