import { Command } from 'commander';
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
} from '@sre-studio/core';
import { createCliProviderRegistry } from '../providers.js';
import { createLogger } from '@sre-studio/shared';

const logger = createLogger('capabilities-command');

export function createCapabilitiesCommand(): Command {
  const cmd = new Command('capabilities')
    .description('List available analysis capabilities')
    .option('--session <id>', 'Session ID (optional)')
    .option('--provider <id>', 'Filter by provider ID (e.g. rizin, android)')
    .option('--format <format>', 'Output format (json|table|markdown|yaml)', 'table')
    .action(async (options: { session?: string; provider?: string; format?: string }) => {
      const spinner = ora('Loading capabilities...').start();

      try {
        const providerRegistry = createCliProviderRegistry();
        let capabilities = providerRegistry.listCapabilities();

        if (options.provider) {
          capabilities = capabilities.filter(c => c.id.startsWith(options.provider + '.'));
        }

        spinner.succeed(chalk.green(`Found ${capabilities.length} capability(ies)`));

        const { createFormatter } = await import('../output/formatter.js');
        const formatter = createFormatter((options.format ?? 'table') as 'json' | 'table' | 'markdown' | 'yaml');

        const outputData = capabilities.map(c => ({
          id: c.id,
          name: c.name,
          category: c.category,
          provider: c.id.split('.')[0],
          description: c.description?.slice(0, 80) + (c.description && c.description.length > 80 ? '...' : ''),
        }));

        console.log(formatter.format(outputData));
      } catch (error) {
        spinner.fail('Capabilities list failed');
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Capabilities failed');
        process.exit(1);
      }
    });

  return cmd;
}
