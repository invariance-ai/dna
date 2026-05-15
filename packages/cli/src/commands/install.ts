import type { Command } from "commander";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import kleur from "kleur";
import { addRootOption, resolveRoot, type RootOption } from "../root.js";
import { AGENT_INSTRUCTIONS, CLAUDE_SKILL, CURSOR_RULE } from "../install/skill-content.js";

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

interface CursorInstallOpts extends RootOption {
  force?: boolean;
  skipMcp?: boolean;
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
    await runInstallClaude(root, {
      force: !!opts.force,
      skipClaudeMd: !!opts.skipClaudeMd,
      useGlobal: !!opts.useGlobal,
    });
    console.log("");
    console.log(kleur.green("installed") + " Claude Code CLI-first dna integration");
    console.log(kleur.dim(`Hooks call: ${dnaCmd(!!opts.useGlobal)}`));
    console.log(
      kleur.dim("Hooks fire on session start, prompts, edits, failures, and turn end."),
    );
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
    await runInstallCodex(root, {
      force: !!opts.force,
      skipAgentsMd: !!opts.skipAgentsMd,
      useGlobal: !!opts.useGlobal,
    });
    console.log("");
    console.log(kleur.green("installed") + " Codex CLI dna integration");
    console.log(kleur.dim(`Notify hook + MCP server use: ${dnaCmd(!!opts.useGlobal)}`));
    console.log(kleur.dim("Codex CLI has no PreToolUse hook; AGENTS.md teaches it to run `dna prepare` like `rg`."));
  });

  addRootOption(
    install
      .command("cursor")
      .description("Install Cursor integration: .cursor/rules/dna.mdc + .cursor/mcp.json")
      .option("--force", "Overwrite existing dna-managed Cursor files")
      .option("--skip-mcp", "Do not write .cursor/mcp.json (rule file only)")
      .option("--use-global", "Configure MCP to call `dna` directly (requires global install)"),
  ).action(async (opts: CursorInstallOpts) => {
    const root = resolveRoot(opts);
    await runInstallCursor(root, {
      force: !!opts.force,
      skipMcp: !!opts.skipMcp,
      useGlobal: !!opts.useGlobal,
    });
    console.log("");
    console.log(kleur.green("installed") + " Cursor dna integration");
    console.log(kleur.dim(`MCP server uses: ${dnaCmd(!!opts.useGlobal)}`));
    console.log(kleur.dim("Cursor has no shell hooks; .cursor/rules/dna.mdc teaches the agent to run `dna prepare` before edits."));
  });
}

export interface RunInstallClaudeOpts {
  force: boolean;
  skipClaudeMd: boolean;
  useGlobal?: boolean;
}

export async function runInstallClaude(root: string, opts: RunInstallClaudeOpts): Promise<void> {
  const cmd = dnaCmd(!!opts.useGlobal);
  const writes: Array<[string, string]> = [
    [path.join(root, ".claude/skills/dna/SKILL.md"), CLAUDE_SKILL],
    [
      path.join(root, ".claude/settings.json"),
      JSON.stringify(claudeSettings(cmd), null, 2) + "\n",
    ],
  ];
  for (const [file, content] of writes) {
    await writeManagedFile(root, file, content, opts.force);
  }
  await upsertClaudeMcp(root, !!opts.useGlobal);
  if (!opts.skipClaudeMd) await upsertAgentMd(root, "CLAUDE.md");
}

export interface RunInstallCodexOpts {
  force: boolean;
  skipAgentsMd: boolean;
  useGlobal?: boolean;
}

export async function runInstallCodex(root: string, opts: RunInstallCodexOpts): Promise<void> {
  const cmd = dnaCmd(!!opts.useGlobal);
  if (!opts.skipAgentsMd) await upsertAgentMd(root, "AGENTS.md");
  await upsertCodexConfig(root, cmd, !!opts.useGlobal);
}

export interface RunInstallCursorOpts {
  force: boolean;
  skipMcp: boolean;
  useGlobal?: boolean;
}

export async function runInstallCursor(root: string, opts: RunInstallCursorOpts): Promise<void> {
  await writeManagedFile(
    root,
    path.join(root, ".cursor/rules/dna.mdc"),
    CURSOR_RULE,
    opts.force,
  );
  if (!opts.skipMcp) await upsertCursorMcp(root, !!opts.useGlobal);
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
 * - SessionStart      → rebuild the index, clear active feature, print preferences
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
      SessionStart: [
        {
          matcher: "startup|resume",
          hooks: [
            {
              type: "command",
              command:
                `${cmd} index --root "$PWD"${silent}; ` +
                `${cmd} feature clear-active --root "$PWD"${silent}; ` +
                `${cmd} session start --root "$PWD"${silent}; ` +
                `${cmd} preferences --root "$PWD" --markdown 2>/dev/null || true`,
            },
          ],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command:
                `${cmd} capture-preference --root "$PWD" --emit 2>/dev/null || true; ` +
                `${cmd} capture-directive --root "$PWD" --emit 2>/dev/null || true; ` +
                `${cmd} context-from-prompt --root "$PWD" 2>/dev/null || true`,
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
        {
          matcher: "Grep|Glob|Read",
          hooks: [
            {
              type: "command",
              command: `${cmd} context-from-path --root "$PWD" 2>/dev/null || true`,
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
              command:
                `${cmd} attach --transcript -${silent}; ` +
                // Gate attribution on a clean index — a stale graph maps touched
                // files to the wrong symbols and silently pollutes weights.
                `if ${cmd} validate --quiet --root "$PWD" >/dev/null 2>&1; then ` +
                `${cmd} feature attribute --git-diff --root "$PWD"${silent}; ` +
                `fi; ` +
                `${cmd} session end --root "$PWD"${silent}`,
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

/**
 * Merge a `dna` entry into `.mcp.json` at the repo root. Claude Code reads
 * this file at session start; we own only the `mcpServers.dna` key and leave
 * the rest of the JSON intact so users can mix in other MCP servers.
 *
 * This is what makes the SKILL.md `prepare_edit` advice actually callable —
 * without `.mcp.json`, the MCP tools are not exposed to the Claude agent.
 */
async function upsertClaudeMcp(root: string, useGlobal: boolean): Promise<void> {
  const file = path.join(root, ".mcp.json");
  let existing: Record<string, unknown> = {};
  try {
    const raw = await readFile(file, "utf8");
    existing = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // create below
  }
  const servers =
    (existing.mcpServers as Record<string, unknown> | undefined) ?? {};
  servers.dna = useGlobal
    ? { command: "dna", args: ["serve"] }
    : { command: "npx", args: ["-y", "@invariance/dna", "serve"] };
  const next = { ...existing, mcpServers: servers };
  await writeFile(file, JSON.stringify(next, null, 2) + "\n");
  console.log(kleur.green(`wrote   ${path.relative(root, file)}`));
}

/**
 * Merge a `dna` entry into `.cursor/mcp.json`. Cursor reads this file at
 * session start; we own only the `mcpServers.dna` key and leave the rest
 * of the JSON intact so users can mix in other MCP servers.
 */
async function upsertCursorMcp(root: string, useGlobal: boolean): Promise<void> {
  const file = path.join(root, ".cursor/mcp.json");
  await mkdir(path.dirname(file), { recursive: true });
  let existing: Record<string, unknown> = {};
  try {
    const raw = await readFile(file, "utf8");
    existing = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // create below
  }
  const servers =
    (existing.mcpServers as Record<string, unknown> | undefined) ?? {};
  servers.dna = useGlobal
    ? { command: "dna", args: ["serve"] }
    : { command: "npx", args: ["-y", "@invariance/dna", "serve"] };
  const next = { ...existing, mcpServers: servers };
  await writeFile(file, JSON.stringify(next, null, 2) + "\n");
  console.log(kleur.green(`wrote   ${path.relative(root, file)}`));
}
