/**
 * Property-based tests for tenant-prefixed naming convention.
 * Ensures the naming function produces consistent, valid results
 * across all possible inputs.
 *
 * **Validates: Requirements 1.6 (multi-tenancy isolation at queue layer)**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { buildTenantName } from '../types';

describe('buildTenantName - Property Tests', () => {
  it('should always produce a string starting with "tenant."', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (tenantId, name) => {
          const result = buildTenantName(tenantId, name);
          expect(result.startsWith('tenant.')).toBe(true);
        }
      )
    );
  });

  it('should always contain the tenantId in the result', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (tenantId, name) => {
          const result = buildTenantName(tenantId, name);
          expect(result).toContain(tenantId);
        }
      )
    );
  });

  it('should always contain the name in the result', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (tenantId, name) => {
          const result = buildTenantName(tenantId, name);
          expect(result).toContain(name);
        }
      )
    );
  });

  it('should produce deterministic output for the same inputs', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (tenantId, name) => {
          const result1 = buildTenantName(tenantId, name);
          const result2 = buildTenantName(tenantId, name);
          expect(result1).toBe(result2);
        }
      )
    );
  });

  it('should produce different outputs for different tenants with same name', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.length > 0),
        fc.string({ minLength: 1, maxLength: 100 }),
        (tenantId1, tenantId2Suffix, name) => {
          // Ensure tenantId2 is different from tenantId1
          const tenantId2 = tenantId1 + tenantId2Suffix;
          const result1 = buildTenantName(tenantId1, name);
          const result2 = buildTenantName(tenantId2, name);
          expect(result1).not.toBe(result2);
        }
      )
    );
  });

  it('should follow the format tenant.{tenantId}.{name}', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z0-9_-]+$/),
        fc.stringMatching(/^[a-zA-Z0-9._-]+$/),
        (tenantId, name) => {
          fc.pre(tenantId.length > 0 && name.length > 0);
          const result = buildTenantName(tenantId, name);
          expect(result).toBe(`tenant.${tenantId}.${name}`);
        }
      )
    );
  });

  it('should produce output length equal to "tenant." + tenantId + "." + name', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (tenantId, name) => {
          const result = buildTenantName(tenantId, name);
          const expectedLength = 'tenant.'.length + tenantId.length + '.'.length + name.length;
          expect(result.length).toBe(expectedLength);
        }
      )
    );
  });
});
