#!/usr/bin/env node
/**
 * Unit tests for the PRC-L294 RLS tenant-GUC ::uuid cast gate.
 * Run with: node --test tools/scripts/check-rls-uuid-cast.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  STATIC_BASELINE,
  castsTenantGucToUuid,
  evaluateRlsUuidCast,
  findLiveViolations,
  findStaticViolations,
} from './check-rls-uuid-cast.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const PRE_240_SHAPE = `CREATE POLICY tenant_isolation ON fee_credit_notes
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);`;
const SAFE_SHAPE = `CREATE POLICY tenant_isolation ON fee_credit_notes
  USING (tenant_id::text = app_tenant_id())
  WITH CHECK (tenant_id::text = app_tenant_id());`;

function fixtureRoot(files) {
  const root = mkdtempSync(join(tmpdir(), 'rls-uuid-cast-'));
  mkdirSync(join(root, 'db/sql'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(root, 'db/sql', name), body);
  }
  return root;
}

test('castsTenantGucToUuid flags every raising cast shape and allows the safe ones', () => {
  for (const bad of [
    "tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid",
    "tenant_id = current_setting('app.current_tenant_id')::uuid",
    '(tenant_id = (app_tenant_id())::uuid)',
    "tenant_id = CAST(current_setting('app.tenant_id', true) AS uuid)",
    // pg_policies deparse of the pre-240 shape
    "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
  ]) {
    assert.equal(castsTenantGucToUuid(bad), true, bad);
  }
  for (const ok of [
    '((tenant_id)::text = app_tenant_id())',
    "((tenant_id)::text = NULLIF(current_setting('app.tenant_id'::text, true), ''::text))",
    '(tenant_id = app_tenant_uuid())',
    "(current_setting('app.platform_admin'::text, true) = '1'::text)",
    "(id = '00000000-0000-0000-0000-000000000000'::uuid)",
    '',
  ]) {
    assert.equal(castsTenantGucToUuid(ok), false, ok);
  }
});

test('findStaticViolations reports policy statements only, ignoring comments', () => {
  assert.equal(findStaticViolations(PRE_240_SHAPE).length, 1);
  assert.equal(findStaticViolations(SAFE_SHAPE).length, 0);
  assert.equal(findStaticViolations(`-- ${PRE_240_SHAPE.replace(/\n/g, ' ')}`).length, 0);
  // A function body that casts the GUC is not a policy.
  assert.equal(
    findStaticViolations(
      "CREATE FUNCTION f() RETURNS uuid AS $$ SELECT current_setting('app.tenant_id')::uuid $$;",
    ).length,
    0,
  );
});

test('static scan gates only files above the baseline', () => {
  const root = fixtureRoot({
    [`${STATIC_BASELINE}_locked.sql`]: PRE_240_SHAPE,
    [`${STATIC_BASELINE + 1}_new.sql`]: PRE_240_SHAPE,
    [`${STATIC_BASELINE + 2}_safe.sql`]: SAFE_SHAPE,
  });
  const { failures } = evaluateRlsUuidCast({ root });
  assert.equal(failures.length, 1);
  assert.match(failures[0], new RegExp(`db/sql/${STATIC_BASELINE + 1}_new\\.sql`));
});

test('live mode fails on a catalog policy that casts the tenant GUC to uuid', () => {
  const root = fixtureRoot({});
  const policies = [
    {
      schema: 'public',
      table: 'fee_credit_notes',
      policy: 'tenant_isolation',
      qual: "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
      withCheck: null,
    },
    {
      schema: 'public',
      table: 'students',
      policy: 'tenant_isolation',
      qual: '(tenant_id = app_tenant_uuid())',
      withCheck: '(tenant_id = app_tenant_uuid())',
    },
  ];
  const { failures } = evaluateRlsUuidCast({
    root,
    live: true,
    databaseUrl: 'postgresql://fake',
    queryLive: () => ({ status: 0, stdout: JSON.stringify(policies), stderr: '', error: '' }),
  });
  assert.deepEqual(failures, [
    'live catalog: public.fee_credit_notes policy tenant_isolation casts the tenant GUC to uuid',
  ]);
  assert.deepEqual(findLiveViolations([policies[1]]), []);
});

test('live mode fails closed on a psql error and on --require-live without a URL', () => {
  const root = fixtureRoot({});
  const err = evaluateRlsUuidCast({
    root,
    live: true,
    databaseUrl: 'postgresql://fake',
    queryLive: () => ({ status: 2, stdout: '', stderr: 'connection refused', error: '' }),
  });
  assert.equal(err.failures.length, 1);
  assert.match(err.failures[0], /connection refused/);

  const noUrl = evaluateRlsUuidCast({ root, live: true, requireLive: true, databaseUrl: '' });
  assert.equal(noUrl.failures.length, 1);
  const skipped = evaluateRlsUuidCast({ root, live: true, databaseUrl: '' });
  assert.equal(skipped.failures.length, 0);
});

test('the repository db/sql corpus passes the static gate', () => {
  const { failures } = evaluateRlsUuidCast({ root: REPO_ROOT });
  assert.deepEqual(failures, []);
});
