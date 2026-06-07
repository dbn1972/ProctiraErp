/**
 * Unit tests for ProviderRegistry.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from './provider-registry.js';
import { ExternalAuthError } from './types.js';
import type { ExternalAuthProvider, AuthInitiationResult, AuthCallbackParams, ExternalUserProfile } from './types.js';

/** Create a mock provider for testing */
function createMockProvider(id: string, type: 'oauth2' | 'oidc' | 'saml' = 'oauth2'): ExternalAuthProvider {
  return {
    providerId: id,
    type,
    displayName: `Mock ${id}`,
    async initiateAuth(_tenantId: string): Promise<AuthInitiationResult> {
      return { redirectUrl: `https://example.com/auth/${id}`, state: 'test-state' };
    },
    async handleCallback(_params: AuthCallbackParams, _tenantId: string): Promise<ExternalUserProfile> {
      return {
        externalId: 'ext-123',
        email: 'user@example.com',
        displayName: 'Test User',
        rawAttributes: {},
      };
    },
  };
}

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  describe('register', () => {
    it('should register a provider successfully', () => {
      const provider = createMockProvider('google');
      registry.register(provider);
      expect(registry.hasProvider('google')).toBe(true);
    });

    it('should throw if registering a provider with duplicate ID', () => {
      const provider1 = createMockProvider('google');
      const provider2 = createMockProvider('google');
      registry.register(provider1);
      expect(() => registry.register(provider2)).toThrow(
        'Provider with ID "google" is already registered',
      );
    });

    it('should allow registering multiple providers with different IDs', () => {
      registry.register(createMockProvider('google'));
      registry.register(createMockProvider('microsoft'));
      registry.register(createMockProvider('custom-oidc', 'oidc'));

      expect(registry.getProviderIds()).toHaveLength(3);
    });
  });

  describe('getProvider', () => {
    it('should return the registered provider', () => {
      const provider = createMockProvider('google');
      registry.register(provider);

      const result = registry.getProvider('google');
      expect(result).toBe(provider);
    });

    it('should throw ExternalAuthError for unknown provider', () => {
      expect(() => registry.getProvider('unknown')).toThrow(ExternalAuthError);
      try {
        registry.getProvider('unknown');
      } catch (error) {
        expect(error).toBeInstanceOf(ExternalAuthError);
        expect((error as ExternalAuthError).code).toBe('PROVIDER_NOT_FOUND');
        expect((error as ExternalAuthError).statusCode).toBe(404);
      }
    });
  });

  describe('hasProvider', () => {
    it('should return true for registered provider', () => {
      registry.register(createMockProvider('google'));
      expect(registry.hasProvider('google')).toBe(true);
    });

    it('should return false for unregistered provider', () => {
      expect(registry.hasProvider('google')).toBe(false);
    });
  });

  describe('listProviders', () => {
    it('should return empty array when no providers registered', () => {
      expect(registry.listProviders()).toEqual([]);
    });

    it('should return summary info for all registered providers', () => {
      registry.register(createMockProvider('google', 'oauth2'));
      registry.register(createMockProvider('custom-idp', 'oidc'));
      registry.register(createMockProvider('corp-saml', 'saml'));

      const list = registry.listProviders();
      expect(list).toHaveLength(3);
      expect(list).toContainEqual({ providerId: 'google', type: 'oauth2', displayName: 'Mock google' });
      expect(list).toContainEqual({ providerId: 'custom-idp', type: 'oidc', displayName: 'Mock custom-idp' });
      expect(list).toContainEqual({ providerId: 'corp-saml', type: 'saml', displayName: 'Mock corp-saml' });
    });
  });

  describe('unregister', () => {
    it('should remove a registered provider', () => {
      registry.register(createMockProvider('google'));
      expect(registry.unregister('google')).toBe(true);
      expect(registry.hasProvider('google')).toBe(false);
    });

    it('should return false for non-existent provider', () => {
      expect(registry.unregister('unknown')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all providers', () => {
      registry.register(createMockProvider('google'));
      registry.register(createMockProvider('microsoft'));
      registry.clear();
      expect(registry.getProviderIds()).toHaveLength(0);
    });
  });
});
