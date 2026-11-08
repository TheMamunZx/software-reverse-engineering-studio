import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import chalk from 'chalk';
import ora from 'ora';
import { createProjectConfig } from '../config/project.js';
import { loadGlobalConfig, getDatabasePath } from '../config/global.js';
import { createInvestigationOrchestrator } from '@sre-studio/core';
import { createCliProviderRegistry } from '../providers.js';
import { createEvidenceEngine } from '@sre-studio/core';
import { createAuthorizationManager, defaultBoundaries } from '@sre-studio/core';
import { createRepository } from '@sre-studio/core';
import { createSessionManager } from '@sre-studio/core';
import { createLogger } from '@sre-studio/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('init-command');

export function createInitCommand(): Command {
  const cmd = new Command('init')
    .description('Initialize a new investigation project')
    .argument('[name]', 'Project name')
    .option('-t, --type <type>', 'Target type (binary|android)')
    .option('--target <path>', 'Initial target path')
    .option('--auth-type <type>', 'Authorization type (owner|explicit-permission|public)')
    .option('--scope <string>', 'Analysis scope description')
    .option('--auth-doc <path>', 'Authorization document reference')
    .option('--force', 'Overwrite existing directory')
    .action(async (name, options) => {
      const spinner = ora('Initializing project...').start();

      try {
        const projectName = name ?? 'investigation-' + Date.now();
        const projectDir = path.resolve(projectName);

        // Check if directory exists
        try {
          await fs.access(projectDir);
          if (!options.force) {
            spinner.fail(`Directory ${projectDir} already exists. Use --force to overwrite.`);
            process.exit(1);
          }
          await fs.rm(projectDir, { recursive: true, force: true });
        } catch {
          // Directory doesn't exist, that's fine
        }

        // Create project directory
        await fs.mkdir(projectDir, { recursive: true });
        await fs.mkdir(path.join(projectDir, '.sre-studio'), { recursive: true });

        // Calculate target hash if target provided
        let targetHash = '';
        if (options.target) {
          try {
            const content = await fs.readFile(options.target);
            targetHash = crypto.createHash('sha256').update(content).digest('hex');
          } catch {
            spinner.warn('Could not read target file for hashing');
          }
        }

        // Create project config
        const projectId = `proj_${crypto.randomBytes(8).toString('hex')}`;
        const config = await createProjectConfig(projectDir, {
          name: projectName,
          projectId,
          targetType: options.type ?? 'binary',
          targetPath: options.target ?? '',
          authorization: {
            type: options.authType ?? 'owner',
            description: options.scope ?? 'Full analysis',
            scope: [options.scope ?? 'Full analysis'],
            limitations: [],
            documentReference: options.authDoc
          }
        });

        let repository;
        try {
          // Initialize database
          const databasePath = config.databasePath;
          repository = createRepository({ dbPath: databasePath });

          // Initialize core components
          const providerRegistry = createCliProviderRegistry();
          const evidenceEngine = createEvidenceEngine({ repository });
          const sessionManager = createSessionManager({
            repository,
            evidenceEngine,
            defaultResourceLimits: config.settings.resourceLimits
          });

          const authorizationManager = createAuthorizationManager(defaultBoundaries, sessionManager, repository);

          // Configure explicit authorization boundaries for the target being initialized.
          // defaultBoundaries is fail-closed: no targets or capabilities are allowed
          // unless explicitly granted. The user is explicitly authorizing this target
          // by passing --target, so we register it in the authorization policy.
          if (options.target) {
            authorizationManager.updateBoundaries({
              allowedTargets: [{
                type: options.type ?? 'binary',
                pathPattern: options.target,
                hashAllowlist: targetHash ? [targetHash] : undefined
              }],
              allowedCapabilities: [] // No capabilities authorized by default; must be granted explicitly
            });
          }

          const orchestrator = createInvestigationOrchestrator({
            sessionManager,
            providerRegistry,
            evidenceEngine,
            authorizationManager
          });

          // Create initial session if target provided
          if (options.target) {
            await orchestrator.startInvestigation({
              projectId,
              name: 'Initial Investigation',
              target: {
                type: options.type ?? 'binary',
                path: options.target,
                hash: targetHash
              },
              scope: options.scope ?? 'Full analysis',
              authorization: {
                type: options.authType ?? 'owner',
                description: options.scope ?? 'Full analysis',
                documentRef: options.authDoc
              },
              createdBy: 'cli'
            });
          }

          spinner.succeed(chalk.green(`Project initialized at ${projectDir}`));
          console.log(chalk.cyan('\nNext steps:'));
          console.log(`  cd ${projectName}`);
          if (options.target) {
            console.log(`  sre-studio analyze --capability ${options.type === 'android' ? 'android.manifest' : 'binary.info'}`);
          }
          console.log(`  sre-studio doctor`);
        } finally {
          repository?.close();
        }

      } catch (error) {
        spinner.fail('Initialization failed');
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Init failed');
        process.exit(1);
      }
    });

  return cmd;
}