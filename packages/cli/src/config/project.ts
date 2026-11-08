import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { createLogger } from '@sre-studio/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('project-config');

export interface ProjectConfig {
  name: string;
  projectId: string;
  databasePath: string;
  createdAt: string;
  targets: Array<{
    targetId: string;
    type: string;
    path: string;
    role: string;
  }>;
  authorization: {
    type: string;
    description: string;
    scope: string[];
    limitations: string[];
    documentReference?: string;
  };
  settings: {
    providers: string[];
    resourceLimits: {
      maxMemoryMb: number;
      maxCpuPercent: number;
      maxDurationMs: number;
    };
  };
}

export async function loadProjectConfig(projectDir: string): Promise<ProjectConfig | null> {
  const configPath = path.join(projectDir, '.sre-studio', 'project.yaml');

  try {
    const content = await fs.readFile(configPath, 'utf-8');
    return yaml.load(content) as ProjectConfig;
  } catch {
    return null;
  }
}

export async function saveProjectConfig(projectDir: string, config: ProjectConfig): Promise<void> {
  const configDir = path.join(projectDir, '.sre-studio');
  const configPath = path.join(configDir, 'project.yaml');

  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(configPath, yaml.dump(config), 'utf-8');
}

export async function createProjectConfig(
  projectDir: string,
  input: {
    name: string;
    projectId: string;
    targetType: string;
    targetPath: string;
    authorization: ProjectConfig['authorization'];
  }
): Promise<ProjectConfig> {
  const targetId = `tgt_${Date.now().toString(16)}`;
  const databasePath = path.join(projectDir, '.sre-studio', 'investigation.db');

  const config: ProjectConfig = {
    name: input.name,
    projectId: input.projectId,
    databasePath,
    createdAt: new Date().toISOString(),
    targets: [{
      targetId,
      type: input.targetType,
      path: input.targetPath,
      role: 'primary'
    }],
    authorization: input.authorization,
    settings: {
      providers: [],
      resourceLimits: {
        maxMemoryMb: 4096,
        maxCpuPercent: 80,
        maxDurationMs: 300000
      }
    }
  };

  await saveProjectConfig(projectDir, config);
  return config;
}