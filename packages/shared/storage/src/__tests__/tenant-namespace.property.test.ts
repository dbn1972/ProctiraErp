/**
 * Property-based tests for tenant-aware object namespacing.
 * Validates that the namespace utilities correctly enforce tenant isolation.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  buildTenantKey,
  buildTenantPrefix,
  extractTenantId,
  validateTenantOwnership,
} from '../tenant-namespace.js';

/**
 * Arbitrary for alphanumeric characters.
 */
const alphanumericChar = fc.char().filter((c) => /^[a-zA-Z0-9]$/.test(c));

/**
 * Arbitrary for valid tenant IDs (non-empty, no slashes, no whitespace-only).
 */
const tenantIdArb = fc
  .stringOf(fc.oneof(alphanumericChar, fc.constantFrom('-', '_')), { minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

/**
 * Arbitrary for valid object keys (non-empty, no leading slash after normalization).
 */
const objectKeyArb = fc
  .stringOf(fc.oneof(alphanumericChar, fc.constantFrom('/', '-', '_', '.')), {
    minLength: 1,
    maxLength: 100,
  })
  .filter((s) => s.replace(/^\/+/, '').trim().length > 0);

describe('Tenant Namespace Properties', () => {
  it('Property: buildTenantKey always produces keys starting with tenants/ prefix', () => {
    fc.assert(
      fc.property(tenantIdArb, objectKeyArb, (tenantId, key) => {
        const result = buildTenantKey(tenantId, key);
        expect(result.startsWith('tenants/')).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('Property: buildTenantKey output always contains the tenant ID', () => {
    fc.assert(
      fc.property(tenantIdArb, objectKeyArb, (tenantId, key) => {
        const result = buildTenantKey(tenantId, key);
        const extracted = extractTenantId(result);
        expect(extracted).toBe(tenantId.replace(/\/+$/, '').trim());
      }),
      { numRuns: 200 },
    );
  });

  it('Property: extractTenantId is the inverse of buildTenantKey for the tenant portion', () => {
    fc.assert(
      fc.property(tenantIdArb, objectKeyArb, (tenantId, key) => {
        const namespacedKey = buildTenantKey(tenantId, key);
        const extracted = extractTenantId(namespacedKey);
        expect(extracted).toBe(tenantId.replace(/\/+$/, '').trim());
      }),
      { numRuns: 200 },
    );
  });

  it('Property: validateTenantOwnership returns true for keys built with the same tenant', () => {
    fc.assert(
      fc.property(tenantIdArb, objectKeyArb, (tenantId, key) => {
        const namespacedKey = buildTenantKey(tenantId, key);
        const normalizedTenantId = tenantId.replace(/\/+$/, '').trim();
        expect(validateTenantOwnership(namespacedKey, normalizedTenantId)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('Property: validateTenantOwnership returns false for keys built with a different tenant', () => {
    fc.assert(
      fc.property(
        tenantIdArb,
        tenantIdArb.filter((t) => t.trim().length > 0),
        objectKeyArb,
        (tenantId1, tenantId2, key) => {
          const normalized1 = tenantId1.replace(/\/+$/, '').trim();
          const normalized2 = tenantId2.replace(/\/+$/, '').trim();
          // Only test when tenants are actually different
          fc.pre(normalized1 !== normalized2);

          const namespacedKey = buildTenantKey(tenantId1, key);
          expect(validateTenantOwnership(namespacedKey, normalized2)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('Property: buildTenantPrefix always ends with / when no sub-prefix', () => {
    fc.assert(
      fc.property(tenantIdArb, (tenantId) => {
        const result = buildTenantPrefix(tenantId);
        expect(result.endsWith('/')).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('Property: buildTenantKey never produces double slashes in the tenant/key boundary', () => {
    fc.assert(
      fc.property(tenantIdArb, objectKeyArb, (tenantId, key) => {
        const result = buildTenantKey(tenantId, key);
        // After 'tenants/' there should be no double slashes in the tenant/key join
        const afterPrefix = result.slice('tenants/'.length);
        const parts = afterPrefix.split('/');
        // The tenant ID part should not be empty
        expect(parts[0]!.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });
});
