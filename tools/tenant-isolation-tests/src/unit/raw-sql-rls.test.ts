/**
 * G-103 — raw-SQL RLS contract (unit).
 *
 * Documents and guards the session-variable contract used by
 * `db/sql/015_rls_policies.sql`: policies read `app.tenant_id` via
 * `current_setting('app.tenant_id', true)`. Application helpers must bind
 * that variable (transaction-local) before querying RLS-protected tables.
 *
 * Full live-Postgres proof belongs in integration; this unit check ensures
 * the shared `withPgTenant` binder emits the expected set_config calls.
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 */
import { describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';

import { withPgTenant } from '@proctira/database';

import { distinctTenantPairArb, uuidV4Arb } from '../helpers/index.js';

describe('G-103 raw-SQL RLS — withPgTenant binds app.tenant_id', () => {
  it('set_config targets app.tenant_id (and app.current_tenant_id) for any tenant id', () => {
    fc.assert(
      fc.property(uuidV4Arb, (tenantId) => {
        const queries: Array<{ text: string; values?: unknown[] }> = [];
        const pool = {
          query: async (text: string, values?: unknown[]) => {
            queries.push({ text, values });
            return { rows: [] };
          },
        };

        // Synchronous property body: kick the promise and drain via await outside
        // is awkward; use a sync mock by wrapping in a thenable runner below.
        return { tenantId, pool, queries };
      }),
      { numRuns: 1 },
    );

    // Executable check (fast-check for distinct tenants)
    fc.assert(
      fc.asyncProperty(distinctTenantPairArb, async ({ tenantA, tenantB }) => {
        for (const tenantId of [tenantA, tenantB]) {
          const queries: Array<{ text: string; values?: unknown[] }> = [];
          const client = {
            query: vi.fn(async (text: string, values?: unknown[]) => {
              queries.push({ text, values });
              return { rows: [] };
            }),
            release: vi.fn(),
          };
          const pool = {
            query: vi.fn(),
            connect: vi.fn(async () => client),
          };

          await withPgTenant(pool, tenantId, async (c) => {
            await c.query('SELECT 1 FROM counselling_sessions');
          });

          const configs = queries.filter((q) => q.text.includes('set_config'));
          expect(configs.some((q) => q.text.includes('app.tenant_id'))).toBe(true);
          expect(configs.some((q) => q.text.includes('app.current_tenant_id'))).toBe(true);
          expect(configs.every((q) => q.values?.[0] === tenantId)).toBe(true);
        }
      }),
      { numRuns: 25 },
    );
  });
});
