/**
 * Category 1 — Unit Tests: tenant scoping in every query.
 *
 * Verifies that the simulated RLS-scoped query layer enforces tenant
 * isolation for every CRUD path (insert, find-by-id, find-all, count,
 * update, delete) and refuses to operate without an active tenant.
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 * Validates: Requirements 4.7, 23.2 (tenant_id enforcement)
 */

import { describe, expect, it, beforeEach } from 'vitest';
import * as fc from 'fast-check';

import {
  TenantScopedQueryLayer,
  assertNoForeignTenant,
  distinctTenantPairArb,
  isolationRecordArb,
  entityNameArb,
  uuidV4Arb,
  type IsolationRecord,
} from '../helpers/index.js';

describe('Category 1 — Unit Tests: Tenant Scoping in Every Query', () => {
  let store: TenantScopedQueryLayer<IsolationRecord>;

  beforeEach(() => {
    store = new TenantScopedQueryLayer<IsolationRecord>();
  });

  it('SELECT * returns only rows belonging to the active tenant', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        fc.array(isolationRecordArb, { minLength: 1, maxLength: 6 }),
        fc.array(isolationRecordArb, { minLength: 1, maxLength: 6 }),
        ({ tenantA, tenantB }, recordsA, recordsB) => {
          store.clear();

          store.setCurrentTenant(tenantA);
          for (const r of recordsA) store.insert({ ...r, tenantId: tenantA });

          store.setCurrentTenant(tenantB);
          for (const r of recordsB) store.insert({ ...r, tenantId: tenantB });

          store.setCurrentTenant(tenantA);
          const visibleToA = store.findAll();
          assertNoForeignTenant('unit:select', tenantA, visibleToA);
          expect(visibleToA).toHaveLength(recordsA.length);

          store.setCurrentTenant(tenantB);
          const visibleToB = store.findAll();
          assertNoForeignTenant('unit:select', tenantB, visibleToB);
          expect(visibleToB).toHaveLength(recordsB.length);

          // Sanity: combined storage holds both tenants' data, but neither
          // tenant ever observed the other set.
          expect(store.totalAcrossTenants()).toBe(recordsA.length + recordsB.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('findById returns null when the row belongs to a foreign tenant', () => {
    fc.assert(
      fc.property(distinctTenantPairArb, isolationRecordArb, ({ tenantA, tenantB }, record) => {
        store.clear();

        const owned = { ...record, tenantId: tenantA };
        store.setCurrentTenant(tenantA);
        store.insert(owned);

        store.setCurrentTenant(tenantB);
        expect(store.findById(owned.id)).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('UPDATE refuses to touch foreign-tenant rows', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        isolationRecordArb,
        entityNameArb,
        ({ tenantA, tenantB }, record, newName) => {
          store.clear();

          const owned = { ...record, tenantId: tenantA };
          store.setCurrentTenant(tenantA);
          store.insert(owned);

          store.setCurrentTenant(tenantB);
          expect(store.update(owned.id, { name: newName })).toBe(false);

          store.setCurrentTenant(tenantA);
          expect(store.findById(owned.id)?.name).toBe(owned.name);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('DELETE refuses to remove foreign-tenant rows', () => {
    fc.assert(
      fc.property(distinctTenantPairArb, isolationRecordArb, ({ tenantA, tenantB }, record) => {
        store.clear();

        const owned = { ...record, tenantId: tenantA };
        store.setCurrentTenant(tenantA);
        store.insert(owned);

        store.setCurrentTenant(tenantB);
        expect(store.delete(owned.id)).toBe(false);

        store.setCurrentTenant(tenantA);
        expect(store.findById(owned.id)).not.toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('COUNT only counts the active tenant', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        fc.array(isolationRecordArb, { minLength: 1, maxLength: 8 }),
        fc.array(isolationRecordArb, { minLength: 1, maxLength: 8 }),
        ({ tenantA, tenantB }, recordsA, recordsB) => {
          store.clear();

          store.setCurrentTenant(tenantA);
          for (const r of recordsA) store.insert({ ...r, tenantId: tenantA });
          store.setCurrentTenant(tenantB);
          for (const r of recordsB) store.insert({ ...r, tenantId: tenantB });

          store.setCurrentTenant(tenantA);
          expect(store.count()).toBe(recordsA.length);
          store.setCurrentTenant(tenantB);
          expect(store.count()).toBe(recordsB.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('queries without tenant context return empty results', () => {
    fc.assert(
      fc.property(
        uuidV4Arb,
        fc.array(isolationRecordArb, { minLength: 1, maxLength: 5 }),
        (tenantId, records) => {
          store.clear();
          store.setCurrentTenant(tenantId);
          for (const r of records) store.insert({ ...r, tenantId });

          store.clearTenant();
          expect(store.findAll()).toEqual([]);
          expect(store.count()).toBe(0);
          expect(store.findById(records[0]!.id)).toBeNull();
        },
      ),
      { numRuns: 50 },
    );
  });

  it('insert refuses to write a row carrying a foreign tenantId', () => {
    fc.assert(
      fc.property(distinctTenantPairArb, isolationRecordArb, ({ tenantA, tenantB }, record) => {
        store.clear();
        store.setCurrentTenant(tenantA);
        expect(() => store.insert({ ...record, tenantId: tenantB })).toThrowError(/RLS violation/);
      }),
      { numRuns: 50 },
    );
  });
});
