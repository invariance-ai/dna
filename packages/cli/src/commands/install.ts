import type { Command } from "commander";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import kleur from "kleur";
import { addRootOption, resolveRoot, type RootOption } from "../root.js";

const AGENT_INSTRUCTIONS = `<!-- dna:start -->
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
  useGlobal?: boolean;
}

interface CodexInstallOpts extends RootOption {
  force?: boolean;
  skipAgentsMd?: boolean;
  useGlobal?: boolean;
}

/** Command prefix for hooks. npx-by-default keeps the global install optional. */
function dnaCmd(useGlobal: boolean): string {
  return useGlobal ? "dna" : "npx -y @invariance/dna";
}

export function registerInstall(program: Command): void {
  const install = program.command("install").description("Install dna agent integrations");

  addRootOption(
    install
      .command("claude")
      .description("Install Claude Code CLI-first instructions, skill, and hooks")
      .option("--force", "Overwrite existing dna-managed Claude files")
      .option("--skip-claude-md", "Do not append dna instructions to CLAUDE.md")
      .option("--use-global", "Generate hooks that call `dna` directly (requires global install)"),
  ).action(async (opts: InstallOpts) => {
    const root = resolveRoot(opts);
    const cmd = dnaCmd(!!opts.useGlobal);
    const writes: Array<[string, string]> = [
      [path.join(root, ".claude/skills/dna/SKILL.md"), DNA_SKILL],
      [
        path.join(root, ".claude/settings.json"),
        JSON.stringify(claudeSettings(cmd), null, 2) + "\n",
      ],
    ];

    for (const [file, content] of writes) {
      await writeManagedFile(root, file, content, !!opts.force);
    }

    if (!opts.skipClaudeMd) await upsertAgentMd(root, "CLAUDE.md");

    console.log("");
    console.log(kleur.green("installed") + " Claude Code CLI-first dna integration");
    console.log(kleur.dim(`Hooks call: ${cmd}`));
    console.log(kleur.dim("Next: run `dna index`, then Claude Code can shell out to dna like rg."));
  });

  addRootOption(
    install
      .command("codex")
      .description("Install Codex CLI integration: AGENTS.md, .codex/config.toml notify + MCP")
      .option("--force", "Overwrite existing dna-managed Codex files")
      .option("--skip-agents-md", "Do not append dna instructions to AGENTS.md")
      .option("--use-global", "Configure Codex to call `dna` directly (requires global install)"),
  ).action(async (opts: CodexInstallOpts) => {
    const root = resolveRoot(opts);
    const cmd = dnaCmd(!!opts.useGlobal);

    if (!opts.skipAgentsMd) await upsertAgentMd(root, "AGENTS.md");

    await upsertCodexConfig(root, cmd, !!opts.useGlobal);

    console.log("");
    console.log(kleur.green("installed") + " Codex CLI dna integration");
    console.log(kleur.dim(`Notify hook + MCP server use: ${cmd}`));
    console.log(kleur.dim("Codex CLI has no PreToolUse hook; AGENTS.md teaches it to run `dna prepare` like `rg`."));
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

async function upsertAgentMd(root: string, filename: string): Promise<void> {
  const file = path.join(root, filename);
  let existing = "";
  try {
    existing = await readFile(file, "utf8");
  } catch {
    // create below
  }
  const next = existing.includes("<!-- dna:start -->")
    ? existing.replace(/<!-- dna:start -->[\s\S]*?<!-- dna:end -->\n?/m, AGENT_INSTRUCTIONS)
    : `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${AGENT_INSTRUCTIONS}`;
  await writeFile(file, next);
  console.log(kleur.green(`wrote   ${path.relative(root, file)}`));
}

/**
 * Hook surface:
 * - UserPromptSubmit  → auto-load context for symbols named in the prompt
 * - PreToolUse Edit*  → keep the index fresh (cheap, non-blocking)
 * - PostToolUse Bash  → record failures (records nothing if exit code was 0)
 * - Stop              → distill the session transcript into Decisions
 *
 * All commands swallow errors so a hook never breaks the agent.
 */
function claudeSettings(cmd: string): unknown {
  const silent = ` >/dev/null 2>&1 || true`;
  // PostToolUse hooks see $CLAUDE_TOOL_EXIT_CODE; only record on non-zero.
  // Falls back to recording every Bash post-call if the env var isn't set (safe — silent no-op when no prepared symbol).
  const recordFailure =
    `if [ "\${CLAUDE_TOOL_EXIT_CODE:-0}" != "0" ]; then ` +
    `${cmd} record-failure --kind bash --message "exit \${CLAUDE_TOOL_EXIT_CODE:-?}"${silent}; fi`;
  return {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: `${cmd} context-from-prompt --root "$PWD" 2>/dev/null || true`,
            },
          ],
        },
      ],
      PreToolUse: [
        {
          matcher: "Edit|MultiEdit|Write",
          hooks: [
            {
              type: "command",
              command: `${cmd} index --root "$PWD"${silent}`,
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: recordFailure,
            },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: `${cmd} attach --transcript -${silent}`,
            },
          ],
        },
      ],
    },
  };
}

/**
 * Merge dna entries into .codex/config.toml without parsing TOML. We append a
 * managed block delimited by `# dna:start` / `# dna:end` and rewrite that span
 * on subsequent installs. Anything outside the markers is preserved verbatim.
 */
async function upsertCodexConfig(root: string, cmd: string, useGlobal: boolean): Promise<void> {
  const file = path.join(root, ".codex/config.toml");
  await mkdir(path.dirname(file), { recursive: true });
  let existing = "";
  try {
    existing = await readFile(file, "utf8");
  } catch {
    // create below
  }

  // Codex CLI MCP server registration. When useGlobal=true we point at the `dna`
  // binary directly; otherwise use npx so no global install is required.
  const mcpEntry = useGlobal
    ? `[mcp_servers.dna]\ncommand = "dna"\nargs = ["serve"]\n`
    : `[mcp_servers.dna]\ncommand = "npx"\nargs = ["-y", "@invariance/dna", "serve"]\n`;

  const notifyArgs = useGlobal
    ? `["dna", "attach", "--transcript", "-"]`
    : `["npx", "-y", "@invariance/dna", "attach", "--transcript", "-"]`;

  const block =
    `# dna:start — managed by \`dna install codex\`. Edit outside markers freely.\n` +
    `notify = ${notifyArgs}\n\n` +
    `${mcpEntry}` +
    `# dna:end\n`;

  // Discard noise about the unused cmd param — keep API stable but mark as intentional.
  void cmd;

  const next = existing.includes("# dna:start")
    ? existing.replace(/# dna:start[\s\S]*?# dna:end\n?/m, block)
    : `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${block}`;
  await writeFile(file, next);
  console.log(kleur.green(`wrote   ${path.relative(root, file)}`));
}
