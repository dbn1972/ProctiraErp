/**
 * W1-DATA-12 — tenant GUC canonicalization contract (unit / static).
 *
 * Guards:
 *   - `db/sql/071_tenant_guc_canonical.sql` defines `app_tenant_id()` /
 *     `set_app_tenant_id` and rewrites policies onto the effective reader.
 *   - `@proctira/database` exports a single binder that always sets
 *     `app.tenant_id` and syncs the legacy `app.current_tenant_id` alias.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  APP_TENANT_ID_GUC,
  APP_TENANT_ID_LEGACY_GUC,
  BIND_TENANT_GUC_SQL,
  SET_APP_TENANT_ID_SQL,
} from '@proctira/database';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SQL_071 = join(ROOT, 'db/sql/071_tenant_guc_canonical.sql');
const PG_TENANT = join(ROOT, 'packages/shared/database/src/pg-tenant.ts');
const TENANT_TX = join(ROOT, 'packages/shared/database/src/tenant-transaction.ts');
const TENANT_GUC = join(ROOT, 'packages/shared/database/src/tenant-guc.ts');

describe('W1-DATA-12 tenant GUC canonicalization', () => {
  it('exports canonical GUC name app.tenant_id and legacy alias', () => {
    expect(APP_TENANT_ID_GUC).toBe('app.tenant_id');
    expect(APP_TENANT_ID_LEGACY_GUC).toBe('app.current_tenant_id');
    expect(BIND_TENANT_GUC_SQL).toMatch(/set_config\('app\.tenant_id', \$1, true\)/);
    expect(BIND_TENANT_GUC_SQL).toMatch(/set_config\('app\.current_tenant_id', \$1, true\)/);
    expect(SET_APP_TENANT_ID_SQL).toBe('SELECT set_app_tenant_id($1)');
  });

  it('071 SQL defines app_tenant_id() + set_app_tenant_id and policy rewrite', () => {
    const sql = readFileSync(SQL_071, 'utf8');
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION app_tenant_id\(\)/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION set_app_tenant_id\(p_tenant text\)/);
    expect(sql).toContain("set_config('app.tenant_id'");
    expect(sql).toContain("set_config('app.current_tenant_id'");
    expect(sql).toContain('app_tenant_id()');
    expect(sql).toMatch(/W1-DATA-12/);
    // Policy rewrite loop must touch both historical GUC spellings.
    expect(sql).toMatch(/app\\\.\(tenant_id\|current_tenant_id\)/);
  });

  it('withPgTenant / withTenantTransaction route through bindTenantGuc*', () => {
    const pg = readFileSync(PG_TENANT, 'utf8');
    const tx = readFileSync(TENANT_TX, 'utf8');
    const guc = readFileSync(TENANT_GUC, 'utf8');
    expect(guc).toContain('export async function bindTenantGuc');
    expect(guc).toContain('export async function bindTenantGucPrisma');
    expect(pg).toMatch(/import \{ bindTenantGuc \} from '\.\/tenant-guc/);
    expect(pg).toContain('await bindTenantGuc(');
    expect(tx).toMatch(/import \{ bindTenantGucPrisma \} from '\.\/tenant-guc/);
    expect(tx).toContain('await bindTenantGucPrisma(');
    // No residual dual hand-rolled set_config in the helpers.
    expect(pg).not.toMatch(/set_config\('app\.current_tenant_id'/);
    expect(tx).not.toMatch(/set_config\('app\.current_tenant_id'/);
  });
});
