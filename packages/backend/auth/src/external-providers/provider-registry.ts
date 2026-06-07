/**
 * Provider Registry
 *
 * Manages registered external authentication providers.
 * Provides lookup by provider ID and listing of available providers.
 */
import type { ExternalAuthProvider, ExternalProviderConfig } from './types.js';
import { ExternalAuthError } from './types.js';

/**
 * Registry for external authentication providers.
 * Allows dynamic registration and lookup of providers.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, ExternalAuthProvider>();

  /**
   * Register an external auth provider.
   * @throws Error if a provider with the same ID is already registered
   */
  register(provider: ExternalAuthProvider): void {
    if (this.providers.has(provider.providerId)) {
      throw new Error(
        `Provider with ID "${provider.providerId}" is already registered`,
      );
    }
    this.providers.set(provider.providerId, provider);
  }

  /**
   * Get a provider by its ID.
   * @throws ExternalAuthError if provider is not found
   */
  getProvider(providerId: string): ExternalAuthProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new ExternalAuthError(
        `Identity provider "${providerId}" is not configured`,
        providerId,
        'PROVIDER_NOT_FOUND',
        404,
      );
    }
    return provider;
  }

  /**
   * Check if a provider is registered.
   */
  hasProvider(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  /**
   * Get all registered provider IDs.
   */
  getProviderIds(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get summary info for all registered providers (for UI display).
   */
  listProviders(): Array<{ providerId: string; type: string; displayName: string }> {
    return Array.from(this.providers.values()).map((p) => ({
      providerId: p.providerId,
      type: p.type,
      displayName: p.displayName,
    }));
  }

  /**
   * Remove a provider from the registry.
   */
  unregister(providerId: string): boolean {
    return this.providers.delete(providerId);
  }

  /**
   * Clear all registered providers.
   */
  clear(): void {
    this.providers.clear();
  }
}
