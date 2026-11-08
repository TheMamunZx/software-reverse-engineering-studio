import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import ora from 'ora';
import { loadProjectConfig } from '../config/project.js';
import { createInvestigationOrchestrator } from '@sre-studio/core';
import { createCliProviderRegistry } from '../providers.js';
import { createEvidenceEngine } from '@sre-studio/core';
import { createAuthorizationManager, defaultBoundaries } from '@sre-studio/core';
import { createRepository } from '@sre-studio/core';
import { createSessionManager } from '@sre-studio/core';
import { createLogger } from '@sre-studio/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('status-command');

export function createStatusCommand(): Command {
  const cmd = new Command('status')
    .description('Show investigation session status')
    .option('--session <id>', 'Session ID')
    .option('--format <format>', 'Output format (json|table|markdown)', 'table')
    .action(async (options) => {
      const spinner = ora('Loading session status...').start();

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

        // Initialize core components
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

        spinner.succeed(chalk.green('Session status loaded'));

        const { createFormatter } = await import('../output/formatter.js');
        const formatter = createFormatter(options.format as 'json' | 'table' | 'markdown');

        const outputData = [{
          sessionId: session.id,
          projectId: session.projectId,
          name: session.name,
          status: session.status,
          totalSteps: session.progress.totalSteps,
          completedSteps: session.progress.completedSteps,
          findingsCount: session.progress.findingsCount,
          evidenceCount: session.progress.evidenceCount,
          errors: session.progress.errors.length,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          createdBy: session.createdBy
        }];

        console.log(formatter.format(outputData));

      } catch (error) {
        spinner.fail('Status check failed');
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Status failed');
        process.exit(1);
      } finally {
        repository?.close();
      }
    });

  return cmd;
}