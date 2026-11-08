#!/usr/bin/env node
import { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pino from 'pino';

import { createInitCommand } from './commands/init.js';
import { createAnalyzeCommand } from './commands/analyze.js';
import { createStatusCommand } from './commands/status.js';
import { createTargetCommand } from './commands/target.js';
import { createEvidenceCommand } from './commands/evidence.js';
import { createCapabilitiesCommand } from './commands/capabilities.js';
import { createCloseCommand } from './commands/close.js';
import { createDoctorCommand } from './commands/doctor.js';
import { createConfigCommand } from './commands/config.js';
import { createInvestigateCommand } from './commands/investigate.js';
import { createReportCommand } from './commands/report.js';
import { createProviderCommand } from './commands/provider.js';
import { createAgentConfigCommand } from './commands/agent-config.js';

export const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  }
});

export function createProgram(): Command {
  const program = new Command();

  program
    .name('sre-studio')
    .description('Software Reverse Engineering Studio - Agent-native RE platform')
    .version('0.1.0')
    .option('--verbose', 'Enable verbose logging')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.opts<{ verbose?: boolean }>();
      if (opts.verbose) {
        logger.level = 'debug';
      }
    });

  // Register all commands
  program.addCommand(createInitCommand());
  program.addCommand(createAnalyzeCommand());
  program.addCommand(createStatusCommand());
  program.addCommand(createTargetCommand());
  program.addCommand(createEvidenceCommand());
  program.addCommand(createCapabilitiesCommand());
  program.addCommand(createCloseCommand());
  program.addCommand(createDoctorCommand());
  program.addCommand(createConfigCommand());
  program.addCommand(createInvestigateCommand());
  program.addCommand(createReportCommand());
  program.addCommand(createProviderCommand());
  program.addCommand(createAgentConfigCommand());

  return program;
}

export {
  generateMarkdownReport,
  generateHtmlReport,
  generateSarifReport,
  createReportCommand,
  type ReportFormat,
  type ReportTemplate,
  type ReportOptions,
} from './commands/report.js';

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();
  program.exitOverride();

  try {
    await program.parseAsync(argv);
  } catch (error: any) {
    if (
      error.code === 'commander.helpDisplayed' ||
      error.code === 'commander.help' ||
      error.code === 'commander.versionDisplayed' ||
      error.code === 'commander.version'
    ) {
      return;
    }
    logger.error({ error: error.message }, 'CLI error');
    throw error;
  }
}

// Auto-run if executed directly as entrypoint
const isDirectExecution =
  !process.env['VITEST'] &&
  Boolean(
    process.argv[1] &&
      (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
        process.argv[1].endsWith('sre-studio') ||
        process.argv[1].endsWith('sre-studio.js') ||
        process.argv[1].endsWith('index.js'))
  );

if (isDirectExecution) {
  runCli().catch(() => {
    process.exit(1);
  });
}
