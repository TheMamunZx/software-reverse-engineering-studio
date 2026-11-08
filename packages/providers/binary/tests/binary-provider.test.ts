import { describe, expect, it } from 'vitest';
import {
  RizinProvider,
  createRizinProvider,
  buildConfidence,
  buildEvidence,
} from '../src/index.js';
import type { ProviderConfig } from '@sre-studio/core';
import { ProviderError } from '@sre-studio/shared';
import {
  rabin2InfoFixture,
  rabin2SectionsFixture,
  rabin2SymbolsFixture,
  rabin2StringsFixture,
  rabin2ImportsFixture,
  rabin2CfgFixture,
} from './fixtures.js';

function createProvider(config?: ProviderConfig): RizinProvider {
  return new RizinProvider();
}

describe('RizinProvider — construction and defaults', () => {
  it('has correct provider metadata', () => {
    const provider = createProvider();
    expect(provider.id).toBe('rizin');
    expect(provider.name).toBe('Rizin Binary Provider');
    expect(provider.version).toBe('0.1.0');
    expect(provider.description).toContain('Rizin');
  });

  it('has expected capabilities', () => {
    const provider = createProvider();
    const capIds = provider.capabilities.map((c) => c.id);
    expect(capIds).toContain('binary.info');
    expect(capIds).toContain('binary.sections');
    expect(capIds).toContain('binary.symbols');
    expect(capIds).toContain('binary.strings');
    expect(capIds).toContain('binary.imports');
    expect(capIds).toContain('binary.cfg');
  });

  it('requires rizin tool', () => {
    const provider = createProvider();
    expect(provider.requiredTools.length).toBeGreaterThan(0);
    expect(provider.requiredTools[0].name).toBe('rizin');
  });

  it('factory function returns provider', () => {
    const provider = createRizinProvider();
    expect(provider).toBeInstanceOf(RizinProvider);
  });
});

describe('RizinProvider — fail-closed tool availability', () => {
  it('validateEnvironment reports missing tools when not initialized', async () => {
    const provider = createProvider();
    const result = await provider.validateEnvironment();
    expect(result.valid).toBe(false);
    expect(result.missingTools).toContain('rizin');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('analyze throws ProviderError when tools missing', async () => {
    const provider = createProvider();
    // Do not initialize - tools remain unavailable
    await expect(
      provider.analyze({
        sessionId: 'ses_test',
        targetId: 'tgt_test',
        capabilityId: 'binary.info',
        parameters: {},
      }),
    ).rejects.toThrow(ProviderError);
  });

  it('initialize with no toolPaths sets toolsAvailable to false', async () => {
    const provider = createProvider();
    const result = await provider.initialize({} as ProviderConfig);
    expect(result.success).toBe(true);
    expect(result.availableCapabilities).toEqual([]);
    expect(provider['toolsAvailable']).toBe(false);
  });

  it('initialize with configured toolPaths that exist sets toolsAvailable', async () => {
    const provider = createProvider();
    // Configure a path that exists (the test file itself)
    const result = await provider.initialize({
      toolPaths: { rizin: __filename, rabin2: __filename },
    } as ProviderConfig);
    expect(result.success).toBe(true);
    expect(provider['toolsAvailable']).toBe(true);
    expect(provider['rabin2Path']).toBe(__filename);
    expect(provider['rizinPath']).toBe(__filename);
  });

  it('initialize with configured toolPaths that do not exist sets toolsAvailable false', async () => {
    const provider = createProvider();
    const result = await provider.initialize({
      toolPaths: { rizin: '/nonexistent/rizin', rabin2: '/nonexistent/rabin2' },
    } as ProviderConfig);
    expect(result.success).toBe(true);
    expect(provider['toolsAvailable']).toBe(false);
  });
});

describe('RizinProvider — parser tests with fixture data', () => {
  it('builds info finding from rabin2 -Ij fixture', () => {
    const provider = createProvider();
    const finding = (provider as any).buildInfoFinding(
      {
        sessionId: 'ses_test',
        targetId: 'tgt_test',
        capabilityId: 'binary.info',
        parameters: { targetPath: '/tmp/test.elf' },
      },
      rabin2InfoFixture,
      '0.7.0',
    );

    expect(finding.id).toBeDefined();
    expect(finding.sessionId).toBe('ses_test');
    expect(finding.targetId).toBe('tgt_test');
    expect(finding.providerId).toBe('rizin');
    expect(finding.capabilityId).toBe('binary.info');
    expect(finding.category).toBe('structure');
    expect(finding.severity).toBe('info');
    expect(finding.title).toBe('Binary header information');
    expect(finding.observation).toContain('x86');
    expect(finding.observation).toContain('elf');
    expect(finding.confidence.level).toBeDefined();
    expect(finding.confidence.value).toBeGreaterThanOrEqual(0);
    expect(finding.confidence.value).toBeLessThanOrEqual(1);
    expect(finding.provenance.tool).toBe('rabin2');
    expect(finding.reproducibility.reproducible).toBe(true);
    expect(finding.evidence.length).toBeGreaterThan(0);
    expect(finding.evidence[0].hash).toBeDefined();
    expect(finding.tags).toContain('elf');
    expect(finding.tags).toContain('x86');
  });

  it('builds sections finding from rabin2 -Sj fixture', () => {
    const provider = createProvider();
    const finding = (provider as any).buildSectionsFinding(
      {
        sessionId: 'ses_test',
        targetId: 'tgt_test',
        capabilityId: 'binary.sections',
        parameters: { targetPath: '/tmp/test.elf' },
      },
      rabin2SectionsFixture,
      '0.7.0',
    );

    expect(finding.category).toBe('structure');
    expect(finding.severity).toBe('info');
    expect(finding.title).toBe('Binary sections');
    expect(finding.observation).toContain('3 section(s)');
    expect(finding.provenance.tool).toBe('rabin2');
    expect(finding.evidence.length).toBeGreaterThan(0);
  });

  it('builds symbols finding from rabin2 -sj fixture', () => {
    const provider = createProvider();
    const finding = (provider as any).buildSymbolsFinding(
      {
        sessionId: 'ses_test',
        targetId: 'tgt_test',
        capabilityId: 'binary.symbols',
        parameters: { targetPath: '/tmp/test.elf' },
      },
      rabin2SymbolsFixture,
      '0.7.0',
    );

    expect(finding.category).toBe('code');
    expect(finding.title).toBe('Binary symbols');
    expect(finding.observation).toContain('4 symbol(s)');
    expect(finding.provenance.tool).toBe('rabin2');
    expect(finding.tags).toContain('not-stripped');
  });

  it('builds symbols finding for stripped binary', () => {
    const provider = createProvider();
    const finding = (provider as any).buildSymbolsFinding(
      {
        sessionId: 'ses_test',
        targetId: 'tgt_test',
        capabilityId: 'binary.symbols',
        parameters: { targetPath: '/tmp/test.elf' },
      },
      [],
      '0.7.0',
    );

    expect(finding.observation).toContain('0 symbol(s)');
    expect(finding.tags).toContain('stripped');
    expect(finding.confidence.level).toBe('low');
  });

  it('builds strings finding from rabin2 -zj fixture', () => {
    const provider = createProvider();
    const finding = (provider as any).buildStringsFinding(
      {
        sessionId: 'ses_test',
        targetId: 'tgt_test',
        capabilityId: 'binary.strings',
        parameters: { targetPath: '/tmp/test.elf', minLength: 4 },
      },
      rabin2StringsFixture,
      '0.7.0',
    );

    expect(finding.category).toBe('data');
    expect(finding.title).toBe('Binary strings');
    expect(finding.observation).toContain('2 string(s)');
    expect(finding.provenance.tool).toBe('rabin2');
  });

  it('builds imports finding from rabin2 -ij fixture', () => {
    const provider = createProvider();
    const finding = (provider as any).buildImportsFinding(
      {
        sessionId: 'ses_test',
        targetId: 'tgt_test',
        capabilityId: 'binary.imports',
        parameters: { targetPath: '/tmp/test.elf' },
      },
      rabin2ImportsFixture,
      '0.7.0',
    );

    expect(finding.category).toBe('dependency');
    expect(finding.title).toBe('Binary imports');
    expect(finding.observation).toContain('2 imported function(s)/library(ies)');
    expect(finding.provenance.tool).toBe('rabin2');
  });

  it('builds CFG finding from rabin2 agfj fixture', () => {
    const provider = createProvider();
    const finding = (provider as any).buildCfgFinding(
      {
        sessionId: 'ses_test',
        targetId: 'tgt_test',
        capabilityId: 'binary.cfg',
        parameters: { targetPath: '/tmp/test.elf' },
      },
      rabin2CfgFixture,
      '0.7.0',
    );

    expect(finding.category).toBe('code');
    expect(finding.title).toBe('Control flow graph');
    expect(finding.observation).toContain('function(s)');
    expect(finding.provenance.tool).toBe('rizin');
  });
});

describe('RizinProvider — confidence calculation', () => {
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
    expect(confidence.factors).toHaveLength(1);
  });

  it('clamps confidence to [0, 1]', () => {
    const provider = createProvider();
    const factors = [
      { name: 'max-positive', impact: 'positive' as const, description: 'max', weight: 100.0 },
    ];
    const confidence = buildConfidence(factors);
    expect(confidence.value).toBeLessThanOrEqual(1);
    expect(confidence.level).toBe('high');

    const negativeFactors = [
      { name: 'max-negative', impact: 'negative' as const, description: 'max', weight: 100.0 },
    ];
    const lowConfidence = buildConfidence(negativeFactors);
    expect(lowConfidence.value).toBeGreaterThanOrEqual(0);
    expect(lowConfidence.level).toBe('none');
  });
});

describe('RizinProvider — evidence reference creation', () => {
  it('builds evidence reference with hash', () => {
    const provider = createProvider();
    const ref = buildEvidence(
      'rabin2',
      'rabin2 -Ij /tmp/test.elf',
      'ELF header data',
      { file: '/tmp/test.elf' },
    );

    expect(ref.type).toBe('tool-output');
    expect(ref.tool).toBe('rabin2');
    expect(ref.location.file).toBe('/tmp/test.elf');
    expect(ref.hash).toBeDefined();
    expect(ref.hash.length).toBeGreaterThan(0);
    expect(ref.timestamp).toBeDefined();
    expect(ref.excerpt).toBe('ELF header data');
  });
});

describe('RizinProvider — provenance creation', () => {
  it('builds provenance info', () => {
    const provider = createProvider();
    const prov = (provider as any).buildProvenance(
      {
        sessionId: 'ses_test',
        targetId: 'tgt_test',
        capabilityId: 'binary.info',
        parameters: { targetPath: '/tmp/test.elf' },
      },
      'rabin2',
      'rabin2 -Ij /tmp/test.elf',
      { format: 'elf' },
      '0.7.0',
    );

    expect(prov.tool).toBe('rabin2');
    expect(prov.command).toBe('rabin2 -Ij /tmp/test.elf');
    expect(prov.parameters).toEqual({ format: 'elf' });
    expect(prov.toolVersion).toBe('0.7.0');
    expect(prov.derivedFrom).toEqual([]);
  });
});

describe('RizinProvider — reproducibility creation', () => {
  it('builds reproducibility info', () => {
    const provider = createProvider();
    const repro = (provider as any).buildReproducibility({
      sessionId: 'ses_test',
      targetId: 'tgt_test',
      capabilityId: 'binary.info',
      parameters: { targetPath: '/tmp/test.elf' },
    });

    expect(repro.reproducible).toBe(true);
    expect(repro.environmentId).toBe('ses_test');
    expect(repro.steps.length).toBeGreaterThan(0);
    expect(repro.knownVariations.length).toBeGreaterThan(0);
  });
});
