#!/usr/bin/env node
/** Run with: node --test tools/scripts/check-migration-tenant-inserts.test.mjs */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findTenantInserts } from './check-migration-tenant-inserts.mjs';

test('flags a numbered migration that inserts a tenant', () => {
  const files = [
    { name: '130_new_feature.sql', sql: "INSERT INTO tenants (id, slug) VALUES ('x', 'y');" },
    { name: '131_other.sql', sql: 'insert into public.tenants(id) values (1);' },
  ];
  assert.deepEqual(findTenantInserts(files), ['130_new_feature.sql', '131_other.sql']);
});

test('allows seed files, legacy allowlist, comments and other tables', () => {
  const files = [
    { name: '130b_demo_seed.sql', sql: "INSERT INTO tenants (id) VALUES ('x');" },
    { name: '071_cross_domain_fk_constraints.sql', sql: 'INSERT INTO tenants (id) VALUES (1);' },
    { name: '132_doc.sql', sql: '-- never INSERT INTO tenants (id) here\nSELECT 1;' },
    { name: '133_settings.sql', sql: 'INSERT INTO tenant_settings (id) VALUES (1);' },
  ];
  assert.deepEqual(findTenantInserts(files), []);
});
