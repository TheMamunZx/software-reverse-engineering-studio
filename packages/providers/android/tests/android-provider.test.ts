import { describe, expect, it } from 'vitest';
import {
  AndroidProvider,
  createAndroidProvider,
  buildConfidence,
  buildEvidence,
} from '../src/index.js';
import type { ProviderConfig } from '@sre-studio/core';
import { ProviderError } from '@sre-studio/shared';
import {
  aapt2PermissionsFixture,
  androidManifestFixture,
  apktoolOutputFixture,
  apksignerOutputFixture,
  jadxOutputFixture,
} from './fixtures.js';

function createProvider(config?: ProviderConfig): AndroidProvider {
  return new AndroidProvider();
}

describe('AndroidProvider — construction and defaults', () => {
  it('has correct provider metadata', () => {
    const provider = createProvider();
    expect(provider.id).toBe('android');
    expect(provider.name).toBe('Android APK Provider');
    expect(provider.version).toBe('0.1.0');
    expect(provider.description).toContain('Android');
  });

  it('has expected capabilities', () => {
    const provider = createProvider();
    const capIds = provider.capabilities.map((c) => c.id);
    expect(capIds).toContain('android.manifest');
    expect(capIds).toContain('android.permissions');
    expect(capIds).toContain('android.resources');
    expect(capIds).toContain('android.dex');
    expect(capIds).toContain('android.signing');
  });

  it('requires apktool tool', () => {
    const provider = createProvider();
    expect(provider.requiredTools.length).toBeGreaterThan(0);
    expect(provider.requiredTools[0].name).toBe('apktool');
  });

  it('factory function returns provider', () => {
    const provider = createAndroidProvider();
    expect(provider).toBeInstanceOf(AndroidProvider);
  });
});

describe('AndroidProvider — fail-closed tool availability', () => {
  it('validateEnvironment reports missing core tools', async () => {
    const provider = createProvider();
    const result = await provider.validateEnvironment();
    expect(result.valid).toBe(false);
    expect(result.missingTools).toContain('apktool');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('analyze throws ProviderError when core tools missing', async () => {
    const provider = createProvider();
    await expect(
      provider.analyze({
        sessionId: 'ses_test',
        targetId: 'tgt_test',
        capabilityId: 'android.manifest',
        parameters: {},
      }),
    ).rejects.toThrow(ProviderError);
  });

  it('initialize with no toolPaths sets coreAvailable false', async () => {
    const provider = createProvider();
    const result = await provider.initialize({} as ProviderConfig);
    expect(result.success).toBe(true);
    expect(result.availableCapabilities).toEqual([]);
  });

  it('initialize with configured toolPaths that exist sets coreAvailable', async () => {
    const provider = createProvider();
    const result = await provider.initialize({
      toolPaths: { apktool: __filename },
    } as ProviderConfig);
    expect(result.success).toBe(true);
    expect(provider['apktoolPath']).toBe(__filename);
  });

  it('initialize with configured toolPaths that do not exist sets coreAvailable false', async () => {
    const provider = createProvider();
    const result = await provider.initialize({
      toolPaths: { apktool: '/nonexistent/apktool' },
    } as ProviderConfig);
    expect(result.success).toBe(true);
    expect(provider['apktoolPath']).toBeUndefined();
  });
});

describe('AndroidProvider — manifest parsing', () => {
  it('parses Android manifest from fixture', () => {
    const provider = createProvider();
    const finding = (provider as any).buildManifestFinding(
      {
        sessionId: 'ses_test',
        targetId: 'tgt_test',
        capabilityId: 'android.manifest',
        parameters: { targetPath: '/tmp/test.apk' },
      },
      androidManifestFixture,
      '2.7.0',
    );

    expect(finding.sessionId).toBe('ses_test');
    expect(finding.targetId).toBe('tgt_test');
    expect(finding.providerId).toBe('android');
    expect(finding.capabilityId).toBe('android.manifest');
    expect(finding.category).toBe('configuration');
    expect(finding.title).toBe('Android manifest');
    expect(finding.observation).toContain('com.example.testapp');
    expect(finding.observation).toContain('21');
    expect(finding.observation).toContain('33');
    expect(finding.confidence.level).toBeDefined();
    expect(finding.confidence.value).toBeGreaterThanOrEqual(0);
    expect(finding.confidence.value).toBeLessThanOrEqual(1);
    expect(finding.provenance.tool).toBe('apktool');
    expect(finding.reproducibility.reproducible).toBe(true);
    expect(finding.evidence.length).toBeGreaterThan(0);
    expect(finding.evidence[0].hash).toBeDefined();
    expect(finding.tags).toContain('com.example.testapp');
  });

  it('extracts permissions count from manifest', () => {
    const provider = createProvider();
    const finding = (provider as any).buildManifestFinding(
      {
        sessionId: 'ses_test',
        targetId: 'tgt_test',
        capabilityId: 'android.manifest',
        parameters: { targetPath: '/tmp/test.apk' },
      },
      androidManifestFixture,
      '2.7.0',
    );

    expect(finding.observation).toContain('2 permission(s)');
  });
});

describe('AndroidProvider — permissions parsing', () => {
  it('builds permissions finding from aapt2 fixture', () => {
    const provider = createProvider();
    // Parse permissions from fixture output
    const permissions: string[] = [];
    for (const line of aapt2PermissionsFixture.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('permission:')) {
        permissions.push(trimmed.substring('permission:'.length).trim());
      }
    }

    const finding = (provider as any).buildPermissionsFinding(
      {
        sessionId: 'ses_test',
        targetId: 'tgt_test',
        capabilityId: 'android.permissions',
        parameters: { targetPath: '/tmp/test.apk' },
      },
      permissions,
      '2.7.0',
    );

    expect(finding.category).toBe('configuration');
    expect(finding.title).toBe('Android permissions');
    expect(finding.observation).toContain('4 permission(s)');
    expect(finding.provenance.tool).toBe('aapt2');
    expect(finding.evidence.length).toBeGreaterThan(0);
  });

  it('flags sensitive permissions', () => {
    const provider = createProvider();
    const permissions = [
      'android.permission.INTERNET',
      'android.permission.CAMERA',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.READ_CONTACTS',
      'android.permission.SEND_SMS',
    ];
    const finding = (provider as any).buildPermissionsFinding(
      {
        sessionId: 'ses_test',
        targetId: 'tgt_test',
        capabilityId: 'android.permissions',
        parameters: { targetPath: '/tmp/test.apk' },
      },
      permissions,
      '2.7.0',
    );

    expect(finding.severity).toBe('medium');
    expect(finding.observation).toContain('5 permission(s)');
    expect(finding.observation).toContain('4 potentially sensitive');
  });
});

describe('AndroidProvider — resources scanning', () => {
  it('builds resources finding from fixture data', () => {
    const provider = createProvider();
    const resources = {
      '.xml': 23,
      '.png': 42,
    };
    const finding = (provider as any).buildResourcesFinding(
      {
        sessionId: 'ses_test',
        targetId: 'tgt_test',
        capabilityId: 'android.resources',
        parameters: { targetPath: '/tmp/test.apk' },
      },
      resources,
      '2.7.0',
    );

    expect(finding.category).toBe('data');
    expect(finding.title).toBe('Android resources');
    expect(finding.provenance.tool).toBe('apktool');
    expect(finding.evidence.length).toBeGreaterThan(0);
  });
});

describe('AndroidProvider — DEX finding', () => {
  it('builds DEX finding from JADX output', () => {
    const provider = createProvider();
    const finding = (provider as any).buildDexFinding(
      {
        sessionId: 'ses_test',
        targetId: 'tgt_test',
        capabilityId: 'android.dex',
        parameters: { targetPath: '/tmp/test.apk' },
      },
      { classesDex: true, outputDir: '/tmp/jadx-out' },
      '1.4.0',
    );

    expect(finding.category).toBe('code');
    expect(finding.title).toBe('Android DEX');
    expect(finding.observation).toContain('classes.dex found');
    expect(finding.provenance.tool).toBe('jadx');
  });

  it('handles missing DEX file', () => {
    const provider = createProvider();
    const finding = (provider as any).buildDexFinding(
      {
        sessionId: 'ses_test',
        targetId: 'tgt_test',
        capabilityId: 'android.dex',
        parameters: { targetPath: '/tmp/test.apk' },
      },
      { classesDex: false },
      '1.4.0',
    );

    expect(finding.observation).toContain('DEX analysis completed');
  });
});

describe('AndroidProvider — signing finding', () => {
  it('builds signed APK finding', () => {
    const provider = createProvider();
    const finding = (provider as any).buildSigningFinding(
      {
        sessionId: 'ses_test',
        targetId: 'tgt_test',
        capabilityId: 'android.signing',
        parameters: { targetPath: '/tmp/test.apk' },
      },
      { signed: true, certificateInfo: apksignerOutputFixture },
      '34.0.0',
    );

    expect(finding.category).toBe('security');
    expect(finding.title).toBe('Android signing');
    expect(finding.observation).toContain('APK is signed');
    expect(finding.provenance.tool).toBe('apksigner');
    expect(finding.severity).toBe('info');
  });

  it('builds unsigned APK finding', () => {
    const provider = createProvider();
    const finding = (provider as any).buildSigningFinding(
      {
        sessionId: 'ses_test',
        targetId: 'tgt_test',
        capabilityId: 'android.signing',
        parameters: { targetPath: '/tmp/test.apk' },
      },
      { signed: false, certificateInfo: '' },
      '34.0.0',
    );

    expect(finding.observation).toContain('not signed');
    expect(finding.severity).toBe('low');
  });
});

describe('AndroidProvider — confidence calculation', () => {
  it('calculates confidence from factors', () => {
    const provider = createProvider();
    const factors = [
      { name: 'test-factor', impact: 'positive' as const, description: 'test', weight: 1.0 },
    ];
    const confidence = buildConfidence(factors);
    expect(confidence.level).toBeDefined();
    expect(confidence.value).toBeGreaterThanOrEqual(0);
    expect(confidence.value).toBeLessThanOrEqual(1);
    expect(confidence.justification).toContain('test-factor');
  });

  it('clamps confidence to [0, 1]', () => {
    const provider = createProvider();
    const factors = [
      { name: 'max-positive', impact: 'positive' as const, description: 'max', weight: 100.0 },
    ];
    const confidence = buildConfidence(factors);
    expect(confidence.value).toBeLessThanOrEqual(1);
  });
});

describe('AndroidProvider — evidence reference creation', () => {
  it('builds evidence reference with hash', () => {
    const provider = createProvider();
    const ref = buildEvidence(
      'apktool',
      'apktool d -f -o /tmp/out /tmp/test.apk',
      'APK decompiled',
      { file: '/tmp/test.apk' },
    );

    expect(ref.type).toBe('tool-output');
    expect(ref.tool).toBe('apktool');
    expect(ref.location.file).toBe('/tmp/test.apk');
    expect(ref.hash).toBeDefined();
    expect(ref.hash.length).toBeGreaterThan(0);
    expect(ref.timestamp).toBeDefined();
  });
});

describe('AndroidProvider — provenance creation', () => {
  it('builds provenance info', () => {
    const provider = createProvider();
    const prov = (provider as any).buildProvenance(
      {
        sessionId: 'ses_test',
        targetId: 'tgt_test',
        capabilityId: 'android.manifest',
        parameters: { targetPath: '/tmp/test.apk' },
      },
      'apktool',
      'apktool d /tmp/test.apk',
      { packageName: 'com.example.test' },
      '2.7.0',
    );

    expect(prov.tool).toBe('apktool');
    expect(prov.command).toBe('apktool d /tmp/test.apk');
    expect(prov.parameters).toEqual({ packageName: 'com.example.test' });
    expect(prov.toolVersion).toBe('2.7.0');
    expect(prov.derivedFrom).toEqual([]);
  });
});

describe('AndroidProvider — reproducibility creation', () => {
  it('builds reproducibility info', () => {
    const provider = createProvider();
    const repro = (provider as any).buildReproducibility({
      sessionId: 'ses_test',
      targetId: 'tgt_test',
      capabilityId: 'android.manifest',
      parameters: { targetPath: '/tmp/test.apk' },
    });

    expect(repro.reproducible).toBe(true);
    expect(repro.environmentId).toBe('ses_test');
    expect(repro.steps.length).toBeGreaterThan(0);
    expect(repro.knownVariations.length).toBeGreaterThan(0);
    // Should mention obfuscation
    const hasObfuscationVariation = repro.knownVariations.some(
      (v) => v.condition.includes('obfusc') || v.condition.includes('Proguard'),
    );
    expect(hasObfuscationVariation).toBe(true);
  });
});
