/**
 * W1-ARCH-08 — production must not silently default to sandbox providers.
 */
import { describe, expect, it } from 'vitest';

import {
  isSandboxProvidersExplicitlyAllowed,
  resolveProviderDeliveryMode,
} from './provider-mode-policy.js';

describe('W1-ARCH-08 provider mode policy', () => {
  it('defaults to sandbox outside production', () => {
    expect(resolveProviderDeliveryMode('fees', {})).toBe('sandbox');
    expect(resolveProviderDeliveryMode('fees', { NODE_ENV: 'development' })).toBe('sandbox');
    expect(resolveProviderDeliveryMode('fees', { NODE_ENV: 'test' })).toBe('sandbox');
  });

  it('honors PROVIDER_MODE=live in any environment', () => {
    expect(
      resolveProviderDeliveryMode('notification', {
        NODE_ENV: 'production',
        PROVIDER_MODE: 'live',
      }),
    ).toBe('live');
    expect(resolveProviderDeliveryMode('notification', { PROVIDER_MODE: 'live' })).toBe('live');
  });

  it('refuses silent sandbox default in production', () => {
    expect(() =>
      resolveProviderDeliveryMode('communication', { NODE_ENV: 'production' }),
    ).toThrow(/W1-ARCH-08|silent.*production default/i);
  });

  it('allows sandbox in production only with explicit opt-in', () => {
    expect(
      resolveProviderDeliveryMode('fees', {
        NODE_ENV: 'production',
        ALLOW_SANDBOX_PROVIDERS: '1',
      }),
    ).toBe('sandbox');
    expect(
      resolveProviderDeliveryMode('fees', {
        NODE_ENV: 'production',
        PROVIDER_MODE: 'sandbox',
      }),
    ).toBe('sandbox');
    expect(
      resolveProviderDeliveryMode('fees', {
        NODE_ENV: 'production',
        PROVIDER_MODE: 'sandbox',
        ALLOW_SANDBOX_PROVIDERS: 'true',
      }),
    ).toBe('sandbox');
  });

  it('rejects unknown PROVIDER_MODE values', () => {
    expect(() =>
      resolveProviderDeliveryMode('providers', { PROVIDER_MODE: 'staging' }),
    ).toThrow(/unknown PROVIDER_MODE/);
  });

  it('isSandboxProvidersExplicitlyAllowed matches opt-in forms', () => {
    expect(isSandboxProvidersExplicitlyAllowed({})).toBe(false);
    expect(isSandboxProvidersExplicitlyAllowed({ PROVIDER_MODE: 'sandbox' })).toBe(true);
    expect(isSandboxProvidersExplicitlyAllowed({ ALLOW_SANDBOX_PROVIDERS: 'yes' })).toBe(true);
    expect(isSandboxProvidersExplicitlyAllowed({ PROVIDER_MODE: 'live' })).toBe(false);
  });
});
