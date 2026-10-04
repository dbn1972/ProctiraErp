// PRC-L176: pure helper contract for the k6 load test (run with `node --test`).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  buildSummary,
  bulkAttendanceBodyOk,
  isCrossTenantDenied,
  isReadSuccess,
  validateFixtures,
} from './lib.js';

const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = (name, base) => ({
  name,
  token: `tok-${name}`,
  institutionId: u(base + 1),
  classId: u(base + 2),
  academicPeriodId: u(base + 3),
  studentIds: [u(base + 4), u(base + 5)],
});

test('fixtures: two tenants with own tokens and seeded UUIDs pass', () => {
  const doc = { tenants: [tenant('a', 0), tenant('b', 100)] };
  assert.equal(validateFixtures(doc), doc);
});

test('fixtures: a single tenant is rejected (cross-tenant check impossible)', () => {
  assert.throws(() => validateFixtures({ tenants: [tenant('a', 0)] }), /two tenants/);
});

test('fixtures: missing token, shared token and non-UUID ids are rejected', () => {
  assert.throws(
    () => validateFixtures({ tenants: [{ ...tenant('a', 0), token: '' }, tenant('b', 100)] }),
    /token missing/,
  );
  assert.throws(
    () => validateFixtures({ tenants: [tenant('a', 0), { ...tenant('b', 100), token: 'tok-a' }] }),
    /own token/,
  );
  assert.throws(
    () =>
      validateFixtures({ tenants: [tenant('a', 0), { ...tenant('b', 100), studentIds: ['x'] }] }),
    /non-UUID/,
  );
});

test('reads require 200; 404 is a failure', () => {
  assert.equal(isReadSuccess(200), true);
  assert.equal(isReadSuccess(404), false);
});

test('second tenant token on foreign ids must be 403/404', () => {
  assert.equal(isCrossTenantDenied(403), true);
  assert.equal(isCrossTenantDenied(404), true);
  assert.equal(isCrossTenantDenied(200), false);
  assert.equal(isCrossTenantDenied(500), false);
});

test('bulk attendance body must account for every record', () => {
  const body = JSON.stringify({ recorded: [{}, {}], updated: [{}] });
  assert.equal(bulkAttendanceBodyOk(201, body, 3), true);
  assert.equal(bulkAttendanceBodyOk(201, body, 4), false);
  assert.equal(bulkAttendanceBodyOk(202, body, 3), false);
  assert.equal(bulkAttendanceBodyOk(201, 'not json', 3), false);
});

test('summary fails on threshold breach or cross-tenant leak', () => {
  const ok = buildSummary({
    metrics: {
      http_req_duration: { values: { 'p(95)': 120 }, thresholds: { 'p(95)<500': { ok: true } } },
      errors: { values: { rate: 0 }, thresholds: { 'rate<0.01': { ok: true } } },
    },
  });
  assert.equal(ok.passed, true);
  const breach = buildSummary({
    metrics: {
      http_req_duration: { values: { 'p(95)': 900 }, thresholds: { 'p(95)<500': { ok: false } } },
    },
  });
  assert.equal(breach.passed, false);
  const leak = buildSummary({ metrics: { cross_tenant_leaks: { values: { count: 1 } } } });
  assert.equal(leak.passed, false);
});

test('k6 script has no fake ids, no 404 acceptance and writes a JSON summary', () => {
  const src = readFileSync(new URL('./k6-script.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /randomUUID\(/);
  assert.doesNotMatch(src, /status === 404/);
  assert.doesNotMatch(src, /00000000-0000-4000-8000-0000000000/);
  assert.match(src, /cross_tenant_leaks: \['count==0'\]/);
  assert.match(src, /\[SUMMARY_PATH\]: JSON\.stringify\(summary/);
});
