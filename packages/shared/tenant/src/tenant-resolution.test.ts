import { describe, it, expect } from 'vitest';
import {
  resolveTenantId,
  isValidUuid,
  TenantResolutionError,
} from './tenant-resolution.js';
import type { FastifyRequest } from 'fastify';

/**
 * Creates a minimal mock FastifyRequest for testing tenant resolution.
 */
function createMockRequest(overrides: {
  user?: Record<string, unknown>;
  headers?: Record<string, string | undefined>;
  hostname?: string;
} = {}): FastifyRequest {
  return {
    user: overrides.user,
    headers: overrides.headers ?? {},
    hostname: overrides.hostname ?? 'localhost',
    url: '/test',
  } as unknown as FastifyRequest;
}

describe('tenant-resolution', () => {
  describe('isValidUuid', () => {
    it('should accept valid UUID v4', () => {
      expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isValidUuid('6ba7b810-9dad-41d0-80b4-00c04fd430c8')).toBe(true);
    });

    it('should reject invalid UUIDs', () => {
      expect(isValidUuid('')).toBe(false);
      expect(isValidUuid('not-a-uuid')).toBe(false);
      expect(isValidUuid('550e8400-e29b-11d4-a716-446655440000')).toBe(false); // v1
      expect(isValidUuid('550e8400-e29b-41d4-c716-446655440000')).toBe(false); // wrong variant
    });
  });

  describe('resolveTenantId', () => {
    const validTenantId = '550e8400-e29b-41d4-a716-446655440000';

    describe('JWT claim resolution (highest priority)', () => {
      it('should resolve tenant from JWT claim', () => {
        const request = createMockRequest({
          user: { tenantId: validTenantId },
          headers: { 'x-tenant-id': 'other-id' },
          hostname: 'tenant1.proctira.org',
        });

        const result = resolveTenantId(request);
        expect(result.tenantId).toBe(validTenantId);
        expect(result.source).toBe('jwt');
      });

      it('should use custom JWT claim field name', () => {
        const request = createMockRequest({
          user: { tenant_id: validTenantId },
        });

        const result = resolveTenantId(request, { jwtClaimField: 'tenant_id' });
        expect(result.tenantId).toBe(validTenantId);
        expect(result.source).toBe('jwt');
      });

      it('should throw on invalid UUID in JWT claim', () => {
        const request = createMockRequest({
          user: { tenantId: 'invalid-uuid' },
        });

        expect(() => resolveTenantId(request)).toThrow(TenantResolutionError);
        expect(() => resolveTenantId(request)).toThrow('Invalid tenant ID format in JWT claim');
      });

      it('should skip JWT if user is not set', () => {
        const request = createMockRequest({
          headers: { 'x-tenant-id': validTenantId },
        });

        const result = resolveTenantId(request);
        expect(result.source).toBe('header');
      });

      it('should skip JWT if claim is empty string', () => {
        const request = createMockRequest({
          user: { tenantId: '' },
          headers: { 'x-tenant-id': validTenantId },
        });

        const result = resolveTenantId(request);
        expect(result.source).toBe('header');
      });
    });

    describe('X-Tenant-ID header resolution', () => {
      it('should resolve tenant from header', () => {
        const request = createMockRequest({
          headers: { 'x-tenant-id': validTenantId },
        });

        const result = resolveTenantId(request);
        expect(result.tenantId).toBe(validTenantId);
        expect(result.source).toBe('header');
      });

      it('should trim whitespace from header value', () => {
        const request = createMockRequest({
          headers: { 'x-tenant-id': `  ${validTenantId}  ` },
        });

        const result = resolveTenantId(request);
        expect(result.tenantId).toBe(validTenantId);
      });

      it('should use custom header name', () => {
        const request = createMockRequest({
          headers: { 'x-org-id': validTenantId },
        });

        const result = resolveTenantId(request, { headerName: 'x-org-id' });
        expect(result.tenantId).toBe(validTenantId);
        expect(result.source).toBe('header');
      });

      it('should throw on invalid UUID in header', () => {
        const request = createMockRequest({
          headers: { 'x-tenant-id': 'not-a-uuid' },
        });

        expect(() => resolveTenantId(request)).toThrow(TenantResolutionError);
        expect(() => resolveTenantId(request)).toThrow('Invalid tenant ID format in x-tenant-id header');
      });
    });

    describe('Subdomain resolution', () => {
      it('should resolve tenant from subdomain', () => {
        const request = createMockRequest({
          hostname: 'ministry-edu.proctira.org',
        });

        const result = resolveTenantId(request, { baseDomain: 'proctira.org' });
        expect(result.tenantId).toBe('ministry-edu');
        expect(result.source).toBe('subdomain');
      });

      it('should not require UUID for subdomain-resolved values', () => {
        const request = createMockRequest({
          hostname: 'my-tenant.proctira.org',
        });

        // Should not throw even though 'my-tenant' is not a UUID
        const result = resolveTenantId(request, { baseDomain: 'proctira.org' });
        expect(result.tenantId).toBe('my-tenant');
      });

      it('should skip subdomain for localhost', () => {
        const request = createMockRequest({
          hostname: 'localhost',
        });

        expect(() => resolveTenantId(request)).toThrow(TenantResolutionError);
      });

      it('should skip subdomain for IP addresses', () => {
        const request = createMockRequest({
          hostname: '192.168.1.1',
        });

        expect(() => resolveTenantId(request)).toThrow(TenantResolutionError);
      });

      it('should skip if hostname is the base domain itself', () => {
        const request = createMockRequest({
          hostname: 'proctira.org',
        });

        expect(() => resolveTenantId(request, { baseDomain: 'proctira.org' })).toThrow(
          TenantResolutionError,
        );
      });

      it('should skip multi-level subdomains', () => {
        const request = createMockRequest({
          hostname: 'sub.tenant.proctira.org',
        });

        expect(() => resolveTenantId(request, { baseDomain: 'proctira.org' })).toThrow(
          TenantResolutionError,
        );
      });
    });

    describe('Priority order', () => {
      it('should prefer JWT over header and subdomain', () => {
        const request = createMockRequest({
          user: { tenantId: validTenantId },
          headers: { 'x-tenant-id': '660e8400-e29b-41d4-a716-446655440000' },
          hostname: 'other-tenant.proctira.org',
        });

        const result = resolveTenantId(request);
        expect(result.tenantId).toBe(validTenantId);
        expect(result.source).toBe('jwt');
      });

      it('should prefer header over subdomain', () => {
        const request = createMockRequest({
          headers: { 'x-tenant-id': validTenantId },
          hostname: 'other-tenant.proctira.org',
        });

        const result = resolveTenantId(request, { baseDomain: 'proctira.org' });
        expect(result.tenantId).toBe(validTenantId);
        expect(result.source).toBe('header');
      });
    });

    describe('Error cases', () => {
      it('should throw TenantResolutionError when no tenant found', () => {
        const request = createMockRequest({
          hostname: 'localhost',
        });

        expect(() => resolveTenantId(request)).toThrow(TenantResolutionError);
      });

      it('should include descriptive error message', () => {
        const request = createMockRequest({
          hostname: 'localhost',
        });

        try {
          resolveTenantId(request);
        } catch (error) {
          expect(error).toBeInstanceOf(TenantResolutionError);
          expect((error as TenantResolutionError).statusCode).toBe(401);
          expect((error as TenantResolutionError).code).toBe('TENANT_RESOLUTION_FAILED');
        }
      });

      it('should allow disabling UUID validation', () => {
        const request = createMockRequest({
          headers: { 'x-tenant-id': 'any-string-value' },
        });

        const result = resolveTenantId(request, { requireUuid: false });
        expect(result.tenantId).toBe('any-string-value');
      });
    });
  });
});
