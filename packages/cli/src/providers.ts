import { createProviderRegistry, type ProviderRegistry } from '@sre-studio/core';
import { createRizinProvider } from '@sre-studio/provider-binary';
import { createAndroidProvider } from '@sre-studio/provider-android';

/**
 * Creates and initializes a ProviderRegistry populated with the standard
 * SRE Studio providers (Rizin binary provider and Android provider).
 */
export function createCliProviderRegistry(): ProviderRegistry {
  const registry = createProviderRegistry();
  registry.register(createRizinProvider());
  registry.register(createAndroidProvider());
  return registry;
}

