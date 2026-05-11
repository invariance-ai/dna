import type { Command } from "commander";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import kleur from "kleur";
import { addRootOption, resolveRoot, type RootOption } from "../root.js";

const CLAUDE_INSTRUCTIONS = `<!-- dna:start -->
## dna

Use \`dna\` like \`rg\`: it is a local CLI for repo context before code edits.

Before editing a non-trivial symbol:
\`\`\`bash
dna prepare <symbol> --intent "<one-line intent>"
\`\`\`

When looking for existing helpers:
\`\`\`bash
dna find "<keyword>" --json
\`\`\`

After editing, run the tests dna recommends:
\`\`\`bash
dna tests <symbol> --json
\`\`\`

When the edit teaches you something durable:
\`\`\`bash
dna learn <symbol> --lesson "<one sentence>" --severity <low|medium|high>
dna decide <symbol> --decision "<choice>" --rejected "<alternative>"
\`\`\`
<!-- dna:end -->
`;

const DNA_SKILL = `---
name: dna
description: Use the dna CLI to fetch repo context, impact, tests, invariants, notes, and decisions before editing code.
---

# dna

Use \`dna\` as a shell-first repo context tool. Prefer the CLI surface.

Before editing a non-trivial symbol, run:

\`\`\`bash
dna prepare <symbol> --intent "<short intent>"
\`\`\`

Respect invariants marked \`block\`. Run tests listed by the prepare output or by:

\`\`\`bash
dna tests <symbol> --json
\`\`\`

Before creating a new helper, search for reusable code:

\`\`\`bash
dna find "<keyword>" --json
\`\`\`

After a successful edit, persist durable lessons:

\`\`\`bash
dna learn <symbol> --lesson "<one sentence>" --severity <low|medium|high>
dna decide <symbol> --decision "<choice>" --rejected "<alternative>"
\`\`\`
`;

interface InstallOpts extends RootOption {
  force?: boolean;
  skipClaudeMd?: boolean;
}

export function registerInstall(program: Command): void {
  const install = program.command("install").description("Install dna agent integrations");

  addRootOption(
    install
      .command("claude")
      .description("Install Claude Code CLI-first instructions, skill, and hooks")
      .option("--force", "Overwrite existing dna-managed Claude files")
      .option("--skip-claude-md", "Do not append dna instructions to CLAUDE.md"),
  ).action(async (opts: InstallOpts) => {
    const root = resolveRoot(opts);
    const writes: Array<[string, string]> = [
      [path.join(root, ".claude/skills/dna/SKILL.md"), DNA_SKILL],
      [path.join(root, ".claude/settings.json"), JSON.stringify(claudeSettings(), null, 2) + "\n"],
    ];

    for (const [file, content] of writes) {
      await writeManagedFile(root, file, content, !!opts.force);
    }

    if (!opts.skipClaudeMd) await upsertClaudeMd(root);

    console.log("");
    console.log(kleur.green("installed") + " Claude Code CLI-first dna integration");
    console.log(kleur.dim("Next: run `dna index`, then Claude Code can shell out to dna like rg."));
  });
}

async function writeManagedFile(
  root: string,
  file: string,
  content: string,
  force: boolean,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  if (!force) {
    try {
      await access(file);
      console.log(kleur.dim(`exists  ${path.relative(root, file)}  (use --force to overwrite)`));
      return;
    } catch {
      // create below
    }
  }
  await writeFile(file, content);
  console.log(kleur.green(`wrote   ${path.relative(root, file)}`));
}

async function upsertClaudeMd(root: string): Promise<void> {
  const file = path.join(root, "CLAUDE.md");
  let existing = "";
  try {
    existing = await readFile(file, "utf8");
  } catch {
    // create below
  }
  const next = existing.includes("<!-- dna:start -->")
    ? existing.replace(/<!-- dna:start -->[\s\S]*?<!-- dna:end -->\n?/m, CLAUDE_INSTRUCTIONS)
    : `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${CLAUDE_INSTRUCTIONS}`;
  await writeFile(file, next);
  console.log(kleur.green(`wrote   ${path.relative(root, file)}`));
}

function claudeSettings(): unknown {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: "Edit|MultiEdit|Write",
          hooks: [
            {
              type: "command",
              command: "dna index --root \"$PWD\" >/dev/null 2>&1 || true",
            },
          ],
        },
      ],
    },
  };
}
