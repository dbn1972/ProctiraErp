import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRootFromHere } from '../repo.js';

import type { FixtureManifest } from './fixtures.js';
import { candidateTables, PARAM_TABLE_HINTS, resolveParam } from './param-map.js';
import { AITEST_SEED_REL, seedSteps } from './seed.js';
import { TENANT_KEYS, TENANTS } from './tenants.js';

const root = repoRootFromHere();

describe('synthetic seed', () => {
  it('applies the repo seeds in the uatenv-seed.sh order, each guarded seed with its GUC', () => {
    const steps = seedSteps();
    expect(steps.map((s) => s.file)).toEqual([
      'tools/e2e/seed-e2e-tenants.sql',
      'tools/e2e/seed-e2e-registration.sql',
      'db/seeds/006_sunrise_public_school_demo.sql',
      'tools/scripts/uatenv/uatenv-detail-records.sql',
      AITEST_SEED_REL,
    ]);
    for (const s of steps) expect(existsSync(join(root, s.file))).toBe(true);
    expect(steps[2]?.pgOptions).toBe('-c proctira.allow_demo_seed=on');
    expect(steps[3]?.pgOptions).toBe('-c proctira.allow_uat_seed=on');
    expect(steps[4]?.pgOptions).toBe('-c proctira.allow_aitest_seed=on');
    expect(steps[1]?.vars).toEqual({
      tenant_id: TENANTS.REG.id,
      slug: TENANTS.REG.slug,
      institution_id: '00000000-0000-4000-8000-00000000e101',
    });
  });

  it('aitest-tenants.sql raises before any write unless proctira.allow_aitest_seed=on', () => {
    const sql = readFileSync(join(root, AITEST_SEED_REL), 'utf8');
    const guard = sql.indexOf(
      "current_setting('proctira.allow_aitest_seed', true) IS DISTINCT FROM 'on'",
    );
    expect(guard).toBeGreaterThan(0);
    expect(sql.indexOf('RAISE EXCEPTION', guard)).toBeGreaterThan(guard);
    const firstWrite = Math.min(
      ...['INSERT INTO', 'UPDATE '].map((k) => sql.indexOf(k)).filter((i) => i >= 0),
    );
    expect(guard).toBeLessThan(firstWrite);
    expect(sql).toContain(TENANTS.SUSP.id);
    expect(sql).toContain(TENANTS.EMPTY.id);
    expect(sql).toMatch(/ON CONFLICT \(id\) DO UPDATE/);
  });

  it('keeps tenant ids unique and the e2e ids aligned with tools/e2e/seed-e2e-tenants.sql', () => {
    const ids = TENANT_KEYS.map((k) => TENANTS[k].id);
    expect(new Set(ids).size).toBe(ids.length);
    const e2e = readFileSync(join(root, 'tools/e2e/seed-e2e-tenants.sql'), 'utf8');
    for (const k of ['A', 'AA', 'BB'] as const) expect(e2e).toContain(`'${TENANTS[k].id}', `);
    const sunrise = readFileSync(join(root, 'db/seeds/006_sunrise_public_school_demo.sql'), 'utf8');
    expect(sunrise).toContain(TENANTS.S.id);
  });
});

const manifest = {
  generatedAt: '',
  gitSha: '',
  tenants: Object.fromEntries(
    TENANT_KEYS.map((k) => [
      k,
      { id: TENANTS[k].id, slug: TENANTS[k].slug, status: 'active', institutions: [] },
    ]),
  ),
  ids: {
    students: { S: ['s-1'], A: ['a-1'] },
    fee_invoices: { S: ['inv-1'] },
    transport_routes: { S: ['r-1'] },
    library_items: { S: ['li-1'] },
  },
  principals: { guardians: {}, students: {} },
} as unknown as FixtureManifest;

describe('param-map', () => {
  it('uses hints for named params', () => {
    expect(PARAM_TABLE_HINTS['studentId']).toEqual(['students']);
    expect(resolveParam('studentId', ['', 'api', 'v1', 'x'], manifest, 'S')).toEqual({
      table: 'students',
      id: 's-1',
    });
    expect(resolveParam('studentId', [], manifest, 'A')).toEqual({ table: 'students', id: 'a-1' });
  });

  it('falls back to the previous segments for a bare id', () => {
    expect(candidateTables('id', ['', 'api', 'v1', 'fees', 'invoices'])).toEqual([
      'fee_invoices',
      'fees_invoices',
      'invoices',
    ]);
    expect(resolveParam('id', ['', 'api', 'v1', 'fees', 'invoices'], manifest, 'S')).toEqual({
      table: 'fee_invoices',
      id: 'inv-1',
    });
    expect(resolveParam('id', ['', 'transport', 'routes'], manifest, 'S')?.table).toBe(
      'transport_routes',
    );
    expect(resolveParam('id', ['', 'library'], manifest, 'S')).toBeUndefined();
    expect(resolveParam('tenantId', [], manifest, 'A')).toEqual({
      table: 'tenants',
      id: TENANTS.A.id,
    });
  });
});
