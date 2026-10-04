/**
 * k6 Load Test Script — ProctiraERP Scalability Validation
 *
 * Simulates 1,000 virtual users hitting cached and queue-first endpoints.
 * Validates that:
 * - p95 latency < 500ms
 * - Error rate < 1%
 * - No tenant can read another tenant's student (cross_tenant_leaks == 0)
 *
 * Usage:
 *   LOAD_TEST_FIXTURES=./fixtures.json k6 run tools/load-test/k6-script.js
 *
 * Environment variables:
 *   BASE_URL           — Target API base URL (default: http://localhost:3000)
 *   LOAD_TEST_FIXTURES — Path to a JSON document of seeded fixtures (required):
 *     { "tenants": [ { "name", "token", "institutionId", "classId",
 *                      "academicPeriodId", "studentIds": [...] }, ... ] }
 *     At least two tenants, each with its own token and real seeded ids.
 *   SUMMARY_PATH       — Where to write the JSON summary (default: k6-summary.json)
 *
 * PRC-L176: reads must return 200 (404 on a seeded id is a failure), bulk
 * attendance bodies are asserted, and a second tenant's token must be denied
 * (403/404) on the first tenant's ids.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

import {
  buildSummary,
  bulkAttendanceBodyOk,
  isCrossTenantDenied,
  isReadSuccess,
  validateFixtures,
} from './lib.js';

// ─── Custom Metrics ──────────────────────────────────────────────────────────

const errorRate = new Rate('errors');
const crossTenantLeaks = new Counter('cross_tenant_leaks');
const institutionLatency = new Trend('institution_list_latency', true);
const studentLatency = new Trend('student_get_latency', true);
const bulkAttendanceLatency = new Trend('bulk_attendance_latency', true);

// ─── Configuration ───────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const SUMMARY_PATH = __ENV.SUMMARY_PATH || 'k6-summary.json';
if (!__ENV.LOAD_TEST_FIXTURES) {
  throw new Error('LOAD_TEST_FIXTURES is required (seeded per-tenant ids and tokens)');
}
// open() is only available in the init context.
const FIXTURES = validateFixtures(JSON.parse(open(__ENV.LOAD_TEST_FIXTURES)));

export const options = {
  stages: [
    { duration: '30s', target: 200 }, // Ramp up to 200 VUs
    { duration: '1m', target: 1000 }, // Ramp up to 1,000 VUs
    { duration: '3m', target: 1000 }, // Hold at 1,000 VUs
    { duration: '30s', target: 0 }, // Ramp down
  ],
  thresholds: {
    // p95 latency must be under 500ms
    http_req_duration: ['p(95)<500'],
    institution_list_latency: ['p(95)<500'],
    student_get_latency: ['p(95)<500'],
    bulk_attendance_latency: ['p(95)<500'],
    // Error rate must be under 1%
    errors: ['rate<0.01'],
    // Any cross-tenant read that is not denied fails the run.
    cross_tenant_leaks: ['count==0'],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function headers(tenant) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${tenant.token}`,
  };
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export function setup() {
  // Fail fast when a seeded student is not readable by its own tenant.
  for (const tenant of FIXTURES.tenants) {
    const res = http.get(`${BASE_URL}/api/v1/students/${tenant.studentIds[0]}`, {
      headers: headers(tenant),
      tags: { name: 'setup_fixture_probe' },
    });
    if (!isReadSuccess(res.status)) {
      throw new Error(`fixture probe failed for tenant ${tenant.name}: HTTP ${res.status}`);
    }
  }
  return FIXTURES;
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

export default function (fixtures) {
  const tenantIndex = Math.floor(Math.random() * fixtures.tenants.length);
  const tenant = fixtures.tenants[tenantIndex];
  const scenario = Math.random();

  if (scenario < 0.35) {
    testInstitutionList(tenant);
  } else if (scenario < 0.65) {
    testStudentGet(tenant);
  } else if (scenario < 0.95) {
    testBulkAttendance(tenant);
  } else {
    const foreign = fixtures.tenants[(tenantIndex + 1) % fixtures.tenants.length];
    testCrossTenantDenied(tenant, foreign);
  }

  sleep(0.5 + Math.random() * 1.5); // 0.5–2s think time
}

/**
 * GET /api/v1/institutions — Cached endpoint
 */
function testInstitutionList(tenant) {
  const res = http.get(`${BASE_URL}/api/v1/institutions?page=1&pageSize=20`, {
    headers: headers(tenant),
    tags: { name: 'GET_institutions' },
  });

  institutionLatency.add(res.timings.duration);

  const success = check(res, {
    'institutions: status 200': (r) => isReadSuccess(r.status),
    'institutions: has data': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body !== null && typeof body === 'object';
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!success);
}

/**
 * GET /api/v1/students/:id — Cached endpoint, seeded ids only.
 */
function testStudentGet(tenant) {
  const res = http.get(`${BASE_URL}/api/v1/students/${pick(tenant.studentIds)}`, {
    headers: headers(tenant),
    tags: { name: 'GET_student_by_id' },
  });

  studentLatency.add(res.timings.duration);

  const success = check(res, {
    'student: status 200': (r) => isReadSuccess(r.status),
  });

  errorRate.add(!success);
}

/**
 * GET /api/v1/students/:id with another tenant's token — must be 403/404.
 */
function testCrossTenantDenied(tenant, foreign) {
  const res = http.get(`${BASE_URL}/api/v1/students/${pick(tenant.studentIds)}`, {
    headers: headers(foreign),
    tags: { name: 'GET_student_cross_tenant' },
  });

  const denied = check(res, {
    'cross-tenant: 403 or 404': (r) => isCrossTenantDenied(r.status),
  });
  if (!denied) crossTenantLeaks.add(1);
  errorRate.add(!denied);
}

/**
 * POST /api/v1/attendance/student/bulk — Queue-first endpoint, seeded ids only.
 */
function testBulkAttendance(tenant) {
  const today = new Date().toISOString().split('T')[0];
  const records = tenant.studentIds.map((studentId) => ({
    studentId,
    status: pick(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']),
  }));

  const payload = JSON.stringify({
    institutionId: tenant.institutionId,
    classId: tenant.classId,
    academicPeriodId: tenant.academicPeriodId,
    date: today,
    records,
  });

  const res = http.post(`${BASE_URL}/api/v1/attendance/student/bulk`, payload, {
    headers: headers(tenant),
    tags: { name: 'POST_bulk_attendance' },
  });

  bulkAttendanceLatency.add(res.timings.duration);

  const success = check(res, {
    'bulk attendance: 201 with every record persisted': (r) =>
      bulkAttendanceBodyOk(r.status, r.body, records.length),
  });

  errorRate.add(!success);
}

// ─── Summary ─────────────────────────────────────────────────────────────────

export function handleSummary(data) {
  const summary = buildSummary(data);
  const p95 = summary.p95Ms ?? NaN;
  const errRate = summary.errorRate ?? NaN;

  console.log('═══════════════════════════════════════════════════════');
  console.log('  ProctiraERP Load Test Summary');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  p95 Latency:  ${p95.toFixed(2)}ms (threshold: <500ms)`);
  console.log(`  Error Rate:   ${(errRate * 100).toFixed(3)}% (threshold: <1%)`);
  console.log(`  Cross-tenant leaks: ${summary.crossTenantLeaks} (threshold: 0)`);
  console.log(`  Result: ${summary.passed ? 'PASS' : 'FAIL'}`);
  console.log('═══════════════════════════════════════════════════════');

  return { [SUMMARY_PATH]: JSON.stringify(summary, null, 2) };
}
