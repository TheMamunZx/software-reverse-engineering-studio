import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import chalk from 'chalk';
import ora from 'ora';
import { loadProjectConfig } from '../config/project.js';
import {
  createInvestigationOrchestrator,
  createEvidenceEngine,
  createAuthorizationManager,
  defaultBoundaries,
  createRepository,
  createSessionManager,
  type TargetRole,
  type AuthorizationType,
} from '@sre-studio/core';
import { createCliProviderRegistry } from '../providers.js';
import { createLogger } from '@sre-studio/shared';

const logger = createLogger('target-command');

export function createTargetCommand(): Command {
  const cmd = new Command('target')
    .description('Manage investigation targets')
    .addCommand(createTargetListCommand())
    .addCommand(createTargetAddCommand())
    .addCommand(createTargetRegisterAliasCommand());

  return cmd;
}

function createTargetListCommand(): Command {
  return new Command('list')
    .description('List targets in an investigation')
    .option('--session <id>', 'Session ID')
    .option('--format <format>', 'Output format (json|table|markdown)', 'table')
    .action(async (options: { session?: string; format?: string }) => {
      const spinner = ora('Loading targets...').start();

      let repository;
      try {
        const projectDir = process.cwd();
        const projectConfig = await loadProjectConfig(projectDir);

        if (!projectConfig) {
          spinner.fail('Not in a project directory. Run "sre-studio init" first.');
          process.exit(1);
        }

        repository = createRepository({ dbPath: projectConfig.databasePath });
        const providerRegistry = createCliProviderRegistry();
        const evidenceEngine = createEvidenceEngine({ repository });
        const sessionManager = createSessionManager({
          repository,
          evidenceEngine,
          defaultResourceLimits: projectConfig.settings.resourceLimits,
        });

        let sessionId = options.session;
        if (!sessionId) {
          const sessions = repository.listSessions();
          if (sessions.length > 0) {
            sessionId = sessions[0]?.id;
          }
        }

        if (!sessionId) {
          spinner.fail('No session found. Run "sre-studio init" or specify --session <id>');
          process.exit(1);
        }

        const session = sessionManager.getSession(sessionId);
        if (!session) {
          spinner.fail(`Session not found: ${sessionId}`);
          process.exit(1);
        }

        const targets = sessionManager.getTargets(sessionId);

        spinner.succeed(chalk.green(`Found ${targets.length} target(s) for session ${sessionId}`));

        const { createFormatter } = await import('../output/formatter.js');
        const formatter = createFormatter((options.format ?? 'table') as 'json' | 'table' | 'markdown');

        const outputData = targets.map(t => ({
          targetId: t.id,
          type: t.type,
          path: t.path,
          role: t.role,
          addedAt: t.addedAt,
          authorization: t.authorization.type,
        }));

        console.log(formatter.format(outputData));
      } catch (error) {
        spinner.fail('Target list failed');
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Target list failed');
        process.exit(1);
      } finally {
        repository?.close();
      }
    });
}

function createTargetAddCommand(): Command {
  return new Command('add')
    .description('Register a new target to an investigation')
    .argument('<path>', 'Target file path or URL')
    .option('-t, --type <type>', 'Target type (binary|android)', 'binary')
    .option('--auth-type <type>', 'Authorization type (owner|explicit-permission|public)', 'owner')
    .option('--scope <string>', 'Analysis scope', 'Full analysis')
    .option('--session <id>', 'Attach to existing session ID')
    .option('--role <role>', 'Target role (primary|secondary|reference)', 'secondary')
    .action(async (targetPath: string, options: {
      type?: string;
      authType?: string;
      scope?: string;
      session?: string;
      role?: string;
    }) => {
      const spinner = ora('Registering target...').start();

      let repository;
      try {
        const projectDir = process.cwd();
        const projectConfig = await loadProjectConfig(projectDir);

        if (!projectConfig) {
          spinner.fail('Not in a project directory. Run "sre-studio init" first.');
          process.exit(1);
        }

        repository = createRepository({ dbPath: projectConfig.databasePath });
        const providerRegistry = createCliProviderRegistry();
        const evidenceEngine = createEvidenceEngine({ repository });
        const sessionManager = createSessionManager({
          repository,
          evidenceEngine,
          defaultResourceLimits: projectConfig.settings.resourceLimits,
        });

        let sessionId = options.session;
        if (!sessionId) {
          const sessions = repository.listSessions();
          if (sessions.length > 0) {
            sessionId = sessions[0]?.id;
          }
        }

        if (!sessionId) {
          spinner.fail('No session found. Run "sre-studio init" first or specify --session <id>');
          process.exit(1);
        }

        // Calculate target hash if file exists
        let targetHash = '';
        try {
          const content = await fs.readFile(targetPath);
          targetHash = crypto.createHash('sha256').update(content).digest('hex');
        } catch {
          // Path may be a URL or remote
        }

        const target = sessionManager.registerTarget(sessionId, {
          type: (options.type ?? 'binary') as 'binary' | 'android',
          path: targetPath,
          metadata: {},
          hashes: { sha256: targetHash },
          authorization: {
            type: (options.authType ?? 'owner') as AuthorizationType,
            description: options.scope ?? 'Registered via CLI',
            scope: [options.scope ?? 'Full analysis'],
            limitations: [],
            verified: false,
          },
          role: (options.role ?? 'secondary') as TargetRole,
        });

        spinner.succeed(chalk.green(`Target registered: ${target.id}`));
        console.log(chalk.cyan(`  Session: ${sessionId}`));
        console.log(chalk.cyan(`  Type:    ${target.type}`));
        console.log(chalk.cyan(`  Path:    ${target.path}`));
        console.log(chalk.cyan(`  Role:    ${target.role}`));
      } catch (error) {
        spinner.fail('Target registration failed');
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Target add failed');
        process.exit(1);
      } finally {
        repository?.close();
      }
    });
}

function createTargetRegisterAliasCommand(): Command {
  return new Command('register')
    .description('Alias for "target add"')
    .option('--session <id>', 'Session ID')
    .option('--type <type>', 'Target type (binary|android)', 'binary')
    .option('--path <path>', 'Target file path')
    .option('--hash <hash>', 'Target SHA256 hash')
    .option('--role <role>', 'Target role', 'secondary')
    .action(async (options: { session?: string; type?: string; path?: string; hash?: string; role?: string }) => {
      if (!options.path) {
        console.error(chalk.red('Error: --path is required for target register'));
        process.exit(1);
      }
      const addCmd = createTargetAddCommand();
      await addCmd.parseAsync([options.path, '--type', options.type ?? 'binary', '--role', options.role ?? 'secondary', ...(options.session ? ['--session', options.session] : [])], { from: 'user' });
    });
}
