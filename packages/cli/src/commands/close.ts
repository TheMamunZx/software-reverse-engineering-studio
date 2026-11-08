import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import ora from 'ora';
import { loadProjectConfig, saveProjectConfig } from '../config/project.js';
import { loadGlobalConfig } from '../config/global.js';
import { createInvestigationOrchestrator } from '@sre-studio/core';
import { createCliProviderRegistry } from '../providers.js';
import { createEvidenceEngine } from '@sre-studio/core';
import { createAuthorizationManager, defaultBoundaries } from '@sre-studio/core';
import { createRepository } from '@sre-studio/core';
import { createSessionManager } from '@sre-studio/core';
import { createLogger } from '@sre-studio/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('close-command');

export function createCloseCommand(): Command {
  const cmd = new Command('close')
    .description('Close an investigation session')
    .option('--session <id>', 'Session ID')
    .option('--reason <reason>', 'Close reason (completed|cancelled|error)', 'completed')
    .option('--format <format>', 'Output format (json|table|markdown)', 'table')
    .action(async (options) => {
      const spinner = ora('Closing investigation...').start();

      let repository;
      try {
        let projectDir = process.cwd();
        let projectConfig = await loadProjectConfig(projectDir);

        if (!projectConfig) {
          spinner.fail('Not in a project directory. Run "sre-studio init" first.');
          process.exit(1);
        }

        if (!options.session) {
          spinner.fail('Session ID required. Use --session <id>');
          process.exit(1);
        }

        repository = createRepository({ dbPath: projectConfig.databasePath });
        const providerRegistry = createCliProviderRegistry();
        const evidenceEngine = createEvidenceEngine({ repository });
        const sessionManager = createSessionManager({
          repository,
          evidenceEngine,
          defaultResourceLimits: projectConfig.settings.resourceLimits
        });

        const authorizationManager = createAuthorizationManager(defaultBoundaries, sessionManager, repository);

        const orchestrator = createInvestigationOrchestrator({
          sessionManager,
          providerRegistry,
          evidenceEngine,
          authorizationManager
        });

        const session = orchestrator.getSession(options.session);
        if (!session) {
          spinner.fail(`Session not found: ${options.session}`);
          process.exit(1);
        }

        if (!['completed', 'cancelled', 'error'].includes(options.reason)) {
          spinner.fail('Invalid reason. Must be: completed, cancelled, or error');
          process.exit(1);
        }

        const closed = await orchestrator.closeInvestigation(options.session, options.reason as 'completed' | 'cancelled' | 'error');
        if (!closed) {
          spinner.fail('Failed to close session');
          process.exit(1);
        }

        // Generate final report
        const stats = evidenceEngine.getSessionStatistics(options.session);
        const findings = evidenceEngine.queryFindings({ sessionId: options.session, limit: 1000 });

        spinner.succeed(chalk.green(`Investigation ${options.reason}`));

        const { createFormatter } = await import('../output/formatter.js');
        const formatter = createFormatter(options.format as 'json' | 'table' | 'markdown');

        const outputData = [{
          sessionId: options.session,
          status: options.reason,
          totalFindings: findings.total,
          findingsByCategory: stats.findingsByCategory,
          findingsBySeverity: stats.findingsBySeverity,
          avgConfidence: (stats.avgConfidence * 100).toFixed(1) + '%'
        }];

        console.log(formatter.format(outputData));

        if (options.format === 'markdown' || options.format === 'table') {
          console.log(chalk.cyan('\n--- Final Report ---'));
          console.log(chalk.cyan(`Session: ${options.session}`));
          console.log(chalk.cyan(`Status: ${options.reason}`));
          console.log(chalk.cyan(`Total Findings: ${findings.total}`));
          console.log(chalk.cyan(`Avg Confidence: ${(stats.avgConfidence * 100).toFixed(1)}%`));
        }

      } catch (error) {
        spinner.fail('Close failed');
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Close failed');
        process.exit(1);
      } finally {
        repository?.close();
      }
    });

  return cmd;
}