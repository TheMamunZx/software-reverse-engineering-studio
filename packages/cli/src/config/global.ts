import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import yaml from 'js-yaml';
import { createLogger } from '@sre-studio/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('global-config');

export interface GlobalConfig {
  workspace?: string;
  databasePath?: string;
  providers?: Record<string, { path?: string; enabled: boolean }>;
  resourceLimits?: {
    maxMemoryMb: number;
    maxCpuPercent: number;
    maxDurationMs: number;
  };
  logging?: {
    level: 'debug' | 'info' | 'warn' | 'error';
    pretty: boolean;
  };
}

const DEFAULT_CONFIG: GlobalConfig = {
  databasePath: path.join(os.homedir(), '.sre-studio', 'sre-studio.db'),
  resourceLimits: {
    maxMemoryMb: 4096,
    maxCpuPercent: 80,
    maxDurationMs: 300000
  },
  logging: {
    level: 'info',
    pretty: true
  }
};

export async function ensureConfigDir(): Promise<string> {
  const configDir = path.join(os.homedir(), '.sre-studio');
  await fs.mkdir(configDir, { recursive: true });
  return configDir;
}

export async function loadGlobalConfig(): Promise<GlobalConfig> {
  const configDir = await ensureConfigDir();
  const configPath = path.join(configDir, 'config.yaml');

  try {
    await fs.mkdir(configDir, { recursive: true });

    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const loaded = yaml.load(content) as GlobalConfig;
      return { ...DEFAULT_CONFIG, ...loaded };
    } catch {
      // Config doesn't exist, create default
      await saveGlobalConfig(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Failed to load global config, using defaults');
    return DEFAULT_CONFIG;
  }
}

export async function saveGlobalConfig(config: GlobalConfig): Promise<void> {
  const configDir = path.join(os.homedir(), '.sre-studio');
  const configPath = path.join(configDir, 'config.yaml');

  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(configPath, yaml.dump(config), 'utf-8');
}

export async function getDatabasePath(): Promise<string> {
  const config = await loadGlobalConfig();
  return config.databasePath ?? DEFAULT_CONFIG.databasePath!;
}