import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import ora from 'ora';
import { loadGlobalConfig, saveGlobalConfig } from '../config/global.js';
import { createLogger } from '@sre-studio/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('config-command');

export function createConfigCommand(): Command {
  const cmd = new Command('config')
    .description('Manage global configuration')
    .addCommand(createConfigGetCommand())
    .addCommand(createConfigSetCommand())
    .addCommand(createConfigListCommand());

  return cmd;
}

function createConfigGetCommand(): Command {
  return new Command('get')
    .description('Get a configuration value')
    .argument('<key>', 'Configuration key (e.g. databasePath, logging.level)')
    .action(async (key) => {
      try {
        const config = await loadGlobalConfig();
        const value = getNestedValue(config, key);
        if (value === undefined) {
          console.log(chalk.yellow(`Key not found: ${key}`));
        } else {
          console.log(typeof value === 'object' ? JSON.stringify(value, null, 2) : value);
        }
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Config get failed');
        process.exit(1);
      }
    });
}

function createConfigSetCommand(): Command {
  return new Command('set')
    .description('Set a configuration value')
    .argument('<key>', 'Configuration key')
    .argument('<value>', 'Configuration value')
    .action(async (key, value) => {
      const spinner = ora('Updating configuration...').start();
      try {
        const config = await loadGlobalConfig();

        // Parse value if boolean or number
        let parsedValue: unknown = value;
        if (value === 'true') parsedValue = true;
        else if (value === 'false') parsedValue = false;
        else if (!isNaN(Number(value))) parsedValue = Number(value);

        setNestedValue(config, key, parsedValue);
        await saveGlobalConfig(config);

        spinner.succeed(chalk.green(`Configuration updated: ${key} = ${value}`));
      } catch (error) {
        spinner.fail('Failed to update configuration');
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Config set failed');
        process.exit(1);
      }
    });
}

function createConfigListCommand(): Command {
  return new Command('list')
    .description('List all global configuration')
    .action(async () => {
      try {
        const config = await loadGlobalConfig();
        console.log(JSON.stringify(config, null, 2));
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Config list failed');
        process.exit(1);
      }
    });
}

function getNestedValue(obj: Record<string, any>, path: string): any {
  const parts = path.split('.');
  let curr = obj;
  for (const part of parts) {
    if (curr === null || curr === undefined) return undefined;
    curr = curr[part];
  }
  return curr;
}

function setNestedValue(obj: Record<string, any>, path: string, value: any): void {
  const parts = path.split('.');
  let curr = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!curr[part]) {
      curr[part] = {};
    }
    curr = curr[part];
  }
  curr[parts[parts.length - 1]!] = value;
}