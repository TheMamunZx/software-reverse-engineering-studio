import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { loadGlobalConfig, getDatabasePath, ensureConfigDir } from '../config/global.js';
import { loadProjectConfig } from '../config/project.js';
import { createCliProviderRegistry } from '../providers.js';
import { createLogger } from '@sre-studio/shared';

const logger = createLogger('doctor-command');

export function createDoctorCommand(): Command {
  const cmd = new Command('doctor')
    .description('Check system health and provider availability')
    .option('--project', 'Check project-specific configuration')
    .option('--provider <name>', 'Check specific provider only')
    .option('--fix', 'Attempt auto-repair of environment configuration and paths')
    .option('--json', 'Output results as machine-readable JSON')
    .option('--format <format>', 'Output format (json|table|markdown)', 'table')
    .action(async (options: {
      project?: boolean;
      provider?: string;
      fix?: boolean;
      json?: boolean;
      format?: string;
    }) => {
      const isJson = options.json || options.format === 'json';
      const spinner = isJson ? null : ora('Running system diagnostics...').start();

      try {
        if (options.fix) {
          await ensureConfigDir();
        }

        const globalConfig = await loadGlobalConfig();
        const dbPath = globalConfig.databasePath ?? (await getDatabasePath());
        let projectConfig = null;

        if (options.project || (await loadProjectConfig(process.cwd()))) {
          projectConfig = await loadProjectConfig(process.cwd());
        }

        const checks: Array<{
          name: string;
          status: 'pass' | 'warn' | 'fail';
          message: string;
          details?: string;
        }> = [];

        // 1. Node version check
        const nodeVersion = process.version;
        const nodeMajor = parseInt(nodeVersion.slice(1).split('.')[0] ?? '0', 10);
        if (nodeMajor >= 20) {
          checks.push({ name: 'Node.js Runtime', status: 'pass', message: `v${nodeVersion} (>=20 LTS required)` });
        } else {
          checks.push({ name: 'Node.js Runtime', status: 'fail', message: `v${nodeVersion} (>=20 LTS required)` });
        }

        // 2. Global configuration
        checks.push({ name: 'Global Config', status: 'pass', message: '~/.sre-studio/config.yaml' });

        // 3. Database check
        try {
          await fs.access(dbPath);
          checks.push({ name: 'Global SQLite DB', status: 'pass', message: dbPath });
        } catch {
          if (options.fix) {
            await fs.mkdir(path.dirname(dbPath), { recursive: true });
            checks.push({ name: 'Global SQLite DB', status: 'pass', message: `Directory initialized at ${path.dirname(dbPath)}` });
          } else {
            checks.push({ name: 'Global SQLite DB', status: 'warn', message: 'Not yet created (will initialize on first session)' });
          }
        }

        // 4. Project configuration check (if applicable)
        if (projectConfig) {
          checks.push({ name: 'Project Workspace', status: 'pass', message: `${projectConfig.name} (${projectConfig.projectId})` });
          try {
            await fs.access(projectConfig.databasePath);
            checks.push({ name: 'Project SQLite DB', status: 'pass', message: projectConfig.databasePath });
          } catch {
            checks.push({ name: 'Project SQLite DB', status: 'warn', message: 'Not yet created' });
          }
        } else if (options.project) {
          checks.push({ name: 'Project Workspace', status: 'fail', message: 'No project found in current directory' });
        }

        // 5. Providers validation
        const registry = createCliProviderRegistry();
        let providersToCheck = registry.listProviders();
        if (options.provider) {
          providersToCheck = providersToCheck.filter(p => p.id === options.provider);
          if (providersToCheck.length === 0) {
            checks.push({
              name: `Provider: ${options.provider}`,
              status: 'fail',
              message: `Unknown provider "${options.provider}". Available: ${registry.listProviders().map(p => p.id).join(', ')}`,
            });
          }
        }

        for (const provider of providersToCheck) {
          const envVal = await provider.validateEnvironment();
          const toolStatuses = envVal.availableTools.length > 0
            ? `Available: ${envVal.availableTools.join(', ')}`
            : `Missing: ${envVal.missingTools.join(', ') || 'all required tools'}`;

          checks.push({
            name: `Provider: ${provider.id}`,
            status: envVal.valid ? 'pass' : 'warn',
            message: envVal.valid ? 'All required analysis tools available' : `Missing tools: ${envVal.missingTools.join(', ')}`,
            details: toolStatuses,
          });
        }

        if (spinner) {
          spinner.succeed(chalk.green('System diagnostics complete'));
        }

        if (isJson) {
          console.log(JSON.stringify({ checks }, null, 2));
        } else {
          const { createFormatter } = await import('../output/formatter.js');
          const formatter = createFormatter((options.format ?? 'table') as 'json' | 'table' | 'markdown');

          const outputData = checks.map(c => ({
            component: c.name,
            status: c.status === 'pass' ? 'PASS' : c.status === 'warn' ? 'WARN' : 'FAIL',
            message: c.message,
            details: c.details ?? '',
          }));

          console.log(formatter.format(outputData));
        }
      } catch (error) {
        if (spinner) spinner.fail('Diagnostics failed');
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Doctor failed');
        process.exit(1);
      }
    });

  return cmd;
}
