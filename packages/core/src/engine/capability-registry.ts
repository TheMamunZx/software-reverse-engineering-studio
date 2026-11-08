import type {
  CapabilityProvider,
  ProviderCapability,
  ProviderConfig,
  InitializationResult,
  EnvironmentValidationResult,
  AnalysisRequest,
  AnalysisResult,
  ExternalToolDependency
} from '../types/provider.js';
import { createLogger } from '@sre-studio/shared';

const logger = createLogger('provider-registry');

export class ProviderRegistry {
  private providers = new Map<string, CapabilityProvider>();

  register(provider: CapabilityProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider ${provider.id} already registered`);
    }
    this.providers.set(provider.id, provider);
    logger.info({ providerId: provider.id, name: provider.name, capabilities: provider.capabilities.map(c => c.id) }, 'Provider registered');
  }

  get(id: string): CapabilityProvider | undefined {
    return this.providers.get(id);
  }

  findByCapability(capabilityId: string): CapabilityProvider[] {
    return Array.from(this.providers.values()).filter(p =>
      p.capabilities.some(c => c.id === capabilityId)
    );
  }

  resolveBest(capabilityId: string): CapabilityProvider | null {
    const candidates = this.findByCapability(capabilityId);
    if (candidates.length === 0) return null;

    const initialized = candidates.filter(p => true);
    return initialized[0] ?? candidates[0] ?? null;
  }

  listCapabilities(): ProviderCapability[] {
    return Array.from(this.providers.values()).flatMap(p => [...p.capabilities]);
  }

  listProviders(): CapabilityProvider[] {
    return Array.from(this.providers.values());
  }

  async validateAll(): Promise<{ providers: Array<{ providerId: string; valid: boolean; tools: Array<ExternalToolDependency & { installed: boolean }>; warnings?: string[] }>; allValid: boolean }> {
    const results = await Promise.all(
      Array.from(this.providers.values()).map(async p => {
        const validation = await p.validateEnvironment();
        return {
          providerId: p.id,
          valid: validation.valid,
          tools: [...p.requiredTools].map(tool => ({
            ...tool,
            installed: validation.availableTools.includes(tool.name)
          })),
          warnings: validation.warnings
        };
      })
    );
    return { providers: results, allValid: results.every(r => r.valid) };
  }

  unregister(id: string): boolean {
    return this.providers.delete(id);
  }

  clear(): void {
    this.providers.clear();
  }
}

export function createProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry();
}