/**
 * k6 Load Test Script — ProctiraERP Scalability Validation
 *
 * Simulates 1,000 virtual users hitting cached and queue-first endpoints.
 * Validates that:
 * - p95 latency < 500ms
 * - Error rate < 1%
 *
 * Usage:
 *   k6 run tools/load-test/k6-script.js
 *
 * Environment variables:
 *   BASE_URL — Target API base URL (default: http://localhost:3000)
 *   AUTH_TOKEN — Bearer token for authenticated requests
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ─── Custom Metrics ──────────────────────────────────────────────────────────

const errorRate = new Rate('errors');
const institutionLatency = new Trend('institution_list_latency', true);
const studentLatency = new Trend('student_get_latency', true);
const bulkAttendanceLatency = new Trend('bulk_attendance_latency', true);

// ─── Configuration ───────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';

export const options = {
  stages: [
    { duration: '30s', target: 200 },   // Ramp up to 200 VUs
    { duration: '1m', target: 1000 },    // Ramp up to 1,000 VUs
    { duration: '3m', target: 1000 },    // Hold at 1,000 VUs
    { duration: '30s', target: 0 },      // Ramp down
  ],
  thresholds: {
    // p95 latency must be under 500ms
    'http_req_duration': ['p(95)<500'],
    'institution_list_latency': ['p(95)<500'],
    'student_get_latency': ['p(95)<500'],
    'bulk_attendance_latency': ['p(95)<500'],
    // Error rate must be under 1%
    'errors': ['rate<0.01'],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (AUTH_TOKEN) {
    h['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  }
  return h;
}

/**
 * Generate a random UUID v4 for test data.
 */
function randomUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

export default function () {
  const scenario = Math.random();

  if (scenario < 0.4) {
    testInstitutionList();
  } else if (scenario < 0.7) {
    testStudentGet();
  } else {
    testBulkAttendance();
  }

  sleep(0.5 + Math.random() * 1.5); // 0.5–2s think time
}

/**
 * GET /api/v1/institutions — Cached endpoint
 * Tests the institution list with cache layer.
 */
function testInstitutionList() {
  const res = http.get(`${BASE_URL}/api/v1/institutions?page=1&pageSize=20`, {
    headers: headers(),
    tags: { name: 'GET_institutions' },
  });

  institutionLatency.add(res.timings.duration);

  const success = check(res, {
    'institutions: status 200': (r) => r.status === 200,
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
 * GET /api/v1/students/:id — Cached endpoint
 * Tests individual student lookup with cache layer.
 */
function testStudentGet() {
  // Use a fixed set of student IDs to maximize cache hits
  const studentIds = [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000006',
    '00000000-0000-4000-8000-000000000007',
    '00000000-0000-4000-8000-000000000008',
    '00000000-0000-4000-8000-000000000009',
    '00000000-0000-4000-8000-000000000010',
  ];

  const id = studentIds[Math.floor(Math.random() * studentIds.length)];
  const res = http.get(`${BASE_URL}/api/v1/students/${id}`, {
    headers: headers(),
    tags: { name: 'GET_student_by_id' },
  });

  studentLatency.add(res.timings.duration);

  // Accept 200 (found) or 404 (not found) as valid responses
  const success = check(res, {
    'student: status 200 or 404': (r) => r.status === 200 || r.status === 404,
  });

  errorRate.add(!success);
}

/**
 * POST /api/v1/attendance/student/bulk — Queue-first endpoint
 * Tests bulk attendance submission that goes through the queue.
 */
function testBulkAttendance() {
  const today = new Date().toISOString().split('T')[0];

  const records = [];
  const recordCount = 5 + Math.floor(Math.random() * 25); // 5–30 records per request

  for (let i = 0; i < recordCount; i++) {
    records.push({
      studentId: randomUUID(),
      status: ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'][Math.floor(Math.random() * 4)],
    });
  }

  const payload = JSON.stringify({
    institutionId: randomUUID(),
    classId: randomUUID(),
    academicPeriodId: randomUUID(),
    date: today,
    records,
  });

  const res = http.post(`${BASE_URL}/api/v1/attendance/student/bulk`, payload, {
    headers: headers(),
    tags: { name: 'POST_bulk_attendance' },
  });

  bulkAttendanceLatency.add(res.timings.duration);

  // Accept 200, 201, or 202 (accepted for async processing)
  const success = check(res, {
    'bulk attendance: status 2xx': (r) => r.status >= 200 && r.status < 300,
  });

  errorRate.add(!success);
}

// ─── Lifecycle Hooks ─────────────────────────────────────────────────────────

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration.values['p(95)'];
  const errRate = data.metrics.errors ? data.metrics.errors.values.rate : 0;

  console.log('═══════════════════════════════════════════════════════');
  console.log('  ProctiraERP Load Test Summary');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  p95 Latency:  ${p95.toFixed(2)}ms (threshold: <500ms) ${p95 < 500 ? '✓' : '✗'}`);
  console.log(`  Error Rate:   ${(errRate * 100).toFixed(3)}% (threshold: <1%) ${errRate < 0.01 ? '✓' : '✗'}`);
  console.log('═══════════════════════════════════════════════════════');

  return {};
}
