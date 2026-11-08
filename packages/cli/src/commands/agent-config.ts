import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { createLogger } from '@sre-studio/shared';

const logger = createLogger('agent-config-command');

export type SupportedAgent = 'claude-code' | 'cursor' | 'codex-cli';

export const CLAUDE_CODE_CONFIG = {
  mcpServers: {
    'sre-studio': {
      command: 'sre-studio-mcp',
      args: [],
      env: {
        SRE_STUDIO_WORKSPACE: '${workspaceFolder}',
        SRE_STUDIO_CONFIG: '${workspaceFolder}/.sre-studio/config.yaml',
      },
    },
  },
};

export const CURSOR_CONFIG = {
  mcpServers: {
    'sre-studio': {
      command: 'sre-studio-mcp',
      args: [],
      env: {},
    },
  },
};

export const CODEX_CLI_CONFIG_TOML = `# Codex CLI MCP Server Configuration Example
#
# IMPORTANT: Append this table to your ~/.codex/config.toml (or .codex/config.toml for project scope).
# DO NOT overwrite your entire config.toml file, or you will lose other Codex configurations.
#
# Alternatively, register via the Codex CLI:
#   codex mcp add sre-studio --env SRE_STUDIO_WORKSPACE=. --env SRE_STUDIO_CONFIG=./.sre-studio/config.yaml -- sre-studio-mcp

[mcp_servers.sre-studio]
command = "sre-studio-mcp"
args = []
cwd = "."

[mcp_servers.sre-studio.env]
SRE_STUDIO_WORKSPACE = "."
SRE_STUDIO_CONFIG = "./.sre-studio/config.yaml"
`;

export function generateAgentConfig(agent: SupportedAgent): string {
  switch (agent) {
    case 'claude-code':
      return JSON.stringify(CLAUDE_CODE_CONFIG, null, 2) + '\n';
    case 'cursor':
      return JSON.stringify(CURSOR_CONFIG, null, 2) + '\n';
    case 'codex-cli':
      return CODEX_CLI_CONFIG_TOML;
    default:
      throw new Error(`Unsupported agent: ${agent}. Supported: claude-code, cursor, codex-cli`);
  }
}

export function createAgentConfigCommand(): Command {
  const cmd = new Command('agent-config')
    .description('Generate MCP configuration for AI coding agents')
    .argument('[agent]', 'Agent name (claude-code | cursor | codex-cli)')
    .option('--output <path>', 'Output file path (default: stdout)')
    .option('--auto', 'Auto-generate configurations for detected or all supported agents')
    .action(async (agentArg: string | undefined, options: { output?: string; auto?: boolean }) => {
      try {
        if (options.auto) {
          const spinner = ora('Generating agent configurations...').start();
          const targetDir = options.output ? path.resolve(options.output) : process.cwd();

          // Write claude-code config
          const claudePath = path.join(targetDir, '.mcp.json');
          await fs.writeFile(claudePath, generateAgentConfig('claude-code'), 'utf8');

          // Write cursor config
          const cursorDir = path.join(targetDir, '.cursor');
          await fs.mkdir(cursorDir, { recursive: true });
          const cursorPath = path.join(cursorDir, 'mcp.json');
          await fs.writeFile(cursorPath, generateAgentConfig('cursor'), 'utf8');

          // Write codex config
          const codexDir = path.join(targetDir, '.codex');
          await fs.mkdir(codexDir, { recursive: true });
          const codexPath = path.join(codexDir, 'config.toml');
          await fs.writeFile(codexPath, generateAgentConfig('codex-cli'), 'utf8');

          spinner.succeed(chalk.green('Generated configurations for Claude Code, Cursor, and Codex CLI'));
          console.log(chalk.cyan(`  Claude Code: ${claudePath}`));
          console.log(chalk.cyan(`  Cursor:      ${cursorPath}`));
          console.log(chalk.cyan(`  Codex CLI:   ${codexPath}`));
          return;
        }

        if (!agentArg) {
          console.error(chalk.red('Agent argument required. Usage: sre-studio agent-config <claude-code|cursor|codex-cli> [--output <path>]'));
          process.exit(1);
        }

        const validAgents: SupportedAgent[] = ['claude-code', 'cursor', 'codex-cli'];
        if (!validAgents.includes(agentArg as SupportedAgent)) {
          console.error(chalk.red(`Invalid agent: "${agentArg}". Expected one of: ${validAgents.join(', ')}`));
          process.exit(1);
        }

        const content = generateAgentConfig(agentArg as SupportedAgent);

        if (options.output) {
          const outPath = path.resolve(options.output);
          await fs.mkdir(path.dirname(outPath), { recursive: true });
          await fs.writeFile(outPath, content, 'utf8');
          console.log(chalk.green(`Configuration written to ${outPath}`));
        } else {
          process.stdout.write(content);
        }
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Agent config generation failed');
        process.exit(1);
      }
    });

  return cmd;
}

