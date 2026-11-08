import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadGlobalConfig, saveGlobalConfig } from '../config/global.js';
import { createCliProviderRegistry } from '../providers.js';
import { createLogger } from '@sre-studio/shared';

const logger = createLogger('provider-command');

export function createProviderCommand(): Command {
  const cmd = new Command('provider')
    .description('Manage analysis capability providers')
    .addCommand(createProviderListCommand())
    .addCommand(createProviderStatusCommand())
    .addCommand(createProviderConfigureCommand());

  return cmd;
}

function createProviderListCommand(): Command {
  return new Command('list')
    .description('List registered analysis providers')
    .option('--format <format>', 'Output format (json|table|markdown)', 'table')
    .action(async (options: { format?: string }) => {
      const spinner = ora('Loading providers...').start();

      try {
        const registry = createCliProviderRegistry();
        const providers = registry.listProviders();

        spinner.succeed(chalk.green(`Found ${providers.length} provider(s)`));

        const outputData = providers.map(p => ({
          providerId: p.id,
          name: p.name,
          version: p.version,
          capabilitiesCount: p.capabilities.length,
          requiredTools: p.requiredTools.map(t => t.name).join(', '),
        }));

        const { createFormatter } = await import('../output/formatter.js');
        const formatter = createFormatter((options.format ?? 'table') as 'json' | 'table' | 'markdown');
        console.log(formatter.format(outputData));
      } catch (error) {
        spinner.fail('Failed to list providers');
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Provider list failed');
        process.exit(1);
      }
    });
}

function createProviderStatusCommand(): Command {
  return new Command('status')
    .description('Check provider health and tool availability')
    .argument('<name>', 'Provider ID (e.g. rizin, android)')
    .option('--format <format>', 'Output format (json|table|markdown)', 'table')
    .action(async (name: string, options: { format?: string }) => {
      const spinner = ora(`Checking health for provider: ${name}...`).start();

      try {
        const registry = createCliProviderRegistry();
        const provider = registry.get(name);

        if (!provider) {
          spinner.fail(`Provider not found: ${name}. Run "sre-studio provider list" to view available providers.`);
          process.exit(1);
        }

        const envResult = await provider.validateEnvironment();

        if (envResult.valid) {
          spinner.succeed(chalk.green(`Provider ${name} is healthy and ready for analysis`));
        } else {
          spinner.warn(chalk.yellow(`Provider ${name} has missing dependencies`));
        }

        const outputData = [{
          provider: name,
          status: envResult.valid ? 'ready' : 'degraded',
          availableTools: envResult.availableTools.join(', ') || 'none',
          missingTools: envResult.missingTools.join(', ') || 'none',
          warnings: envResult.warnings.join('; ') || 'none',
        }];

        const { createFormatter } = await import('../output/formatter.js');
        const formatter = createFormatter((options.format ?? 'table') as 'json' | 'table' | 'markdown');
        console.log(formatter.format(outputData));
      } catch (error) {
        spinner.fail(`Status check failed for ${name}`);
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Provider status failed');
        process.exit(1);
      }
    });
}

function createProviderConfigureCommand(): Command {
  return new Command('configure')
    .description('Configure provider settings or binary paths')
    .argument('<name>', 'Provider ID (e.g. rizin, android)')
    .requiredOption('--path <path>', 'Custom path for provider executable')
    .action(async (name: string, options: { path: string }) => {
      const spinner = ora(`Configuring provider: ${name}...`).start();

      try {
        const globalConfig = await loadGlobalConfig();
        const providers = globalConfig.providers ?? {};
        const existing = providers[name];
        providers[name] = {
          enabled: existing ? existing.enabled : true,
          path: options.path,
        };
        globalConfig.providers = providers;
        await saveGlobalConfig(globalConfig);

        spinner.succeed(chalk.green(`Provider ${name} configured: path = ${options.path}`));
      } catch (error) {
        spinner.fail(`Failed to configure provider ${name}`);
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Provider configure failed');
        process.exit(1);
      }
    });
}
