import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createProjectConfig, loadProjectConfig, saveProjectConfig } from '../src/config/project.js';

const projectDir = mkdtempSync(path.join(tmpdir(), 'sre-studio-cli-config-'));

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe('project configuration', () => {
  it('returns null when no project config exists', async () => {
    const missing = path.join(projectDir, 'does-not-exist');
    expect(await loadProjectConfig(missing)).toBeNull();
  });

  it('creates a config with the primary target and writes the yaml file', async () => {
    const config = await createProjectConfig(projectDir, {
      name: 'sample-analysis',
      projectId: 'proj_sample',
      targetType: 'binary',
      targetPath: 'C:/targets/sample.exe',
      authorization: {
        type: 'owner',
        description: 'Local synthetic fixture',
        scope: ['C:/targets/sample.exe'],
        limitations: ['unit test']
      }
    });

    expect(config.projectId).toBe('proj_sample');
    expect(config.name).toBe('sample-analysis');
    expect(config.targets).toHaveLength(1);
    expect(config.targets[0]).toMatchObject({
      type: 'binary',
      path: 'C:/targets/sample.exe',
      role: 'primary'
    });
    expect(config.targets[0].targetId).toMatch(/^tgt_/);
    expect(config.settings.resourceLimits.maxMemoryMb).toBe(4096);

    const savedPath = path.join(projectDir, '.sre-studio', 'project.yaml');
    expect(existsSync(savedPath)).toBe(true);
  });

  it('round-trips a saved config through load/save', async () => {
    const original = await loadProjectConfig(projectDir);
    expect(original).not.toBeNull();
    expect(original?.authorization.type).toBe('owner');

    const edited = { ...original!, name: 'renamed-analysis' };
    await saveProjectConfig(projectDir, edited);

    const reloaded = await loadProjectConfig(projectDir);
    expect(reloaded?.name).toBe('renamed-analysis');
  });
});
