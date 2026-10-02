/**
 * PRC-L150 — base domain read lazily from env; host parsing handles IPv6/ports.
 */
import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveTenantId, TenantResolutionError } from './tenant-resolution.js';

function req(hostname: string): FastifyRequest {
  return { headers: {}, hostname, url: '/x' } as unknown as FastifyRequest;
}

describe('tenant resolution host/env handling (PRC-L150)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('honours TENANT_BASE_DOMAIN set after import', () => {
    vi.stubEnv('TENANT_BASE_DOMAIN', 'schools.example.gov');
    const result = resolveTenantId(req('sunrise.schools.example.gov'));
    expect(result.source).toBe('subdomain');
    expect(result.tenantId).toBe('sunrise');
  });

  it('strips the port from a named host', () => {
    const result = resolveTenantId(req('sunrise.proctira.org:8443'), {
      baseDomain: 'proctira.org',
    });
    expect(result.tenantId).toBe('sunrise');
  });

  it('treats bracketed IPv6 hosts as IPs (no subdomain) instead of mis-splitting', () => {
    expect(() => resolveTenantId(req('[::1]:3000'), { baseDomain: 'proctira.org' })).toThrow(
      TenantResolutionError,
    );
    expect(() => resolveTenantId(req('[2001:db8::1]'), { baseDomain: 'proctira.org' })).toThrow(
      TenantResolutionError,
    );
  });

  it('explicit undefined baseDomain falls back to the env default', () => {
    vi.stubEnv('TENANT_BASE_DOMAIN', 'edu.example');
    const result = resolveTenantId(req('acme.edu.example'), { baseDomain: undefined });
    expect(result.tenantId).toBe('acme');
  });
});
