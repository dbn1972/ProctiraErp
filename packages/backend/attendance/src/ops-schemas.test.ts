/**
 * PRC-L277: ops request body validation — UUID-shaped identifiers and an
 * https:// scheme guard on leave-request attachments, enforced at the HTTP
 * layer (not just unit-tested on the Typebox schema in isolation).
 */
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { AttendanceService } from './attendance-service.js';
import { InMemoryAttendanceRepository } from './in-memory-repository.js';
import { registerAttendanceOpsRoutes } from './ops-routes.js';
import { AttendanceOpsService } from './ops-service.js';
import { InMemoryAttendanceOpsStore } from './ops-store.js';
import { IngestBatchSchema } from './ops-schemas.js';
import { registerAttendanceRoutes } from './routes.js';
import { validate } from '@proctira/validation';

const TENANT_ID = 'tenant-001';
const INSTITUTION_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const PERIOD_ID = '55555555-5555-4555-8555-555555555555';
const DEVICE_ID = 'gate-1';

async function buildApp(roles: string[] = ['teacher']) {
  const repo = new InMemoryAttendanceRepository();
  const store = new InMemoryAttendanceOpsStore();
  const opsService = new AttendanceOpsService(store, repo);
  const attendanceService = new AttendanceService(repo);

  const app = Fastify();
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { tenantId: string }).tenantId = TENANT_ID;
  });
  app.decorateRequest('user', undefined);
  app.addHook('onRequest', async (request) => {
    // 'teacher' has attendance.write access per attendance-access.ts's
    // ACTION_ROLES; the HTTP package-RBAC guard would 403 before this
    // suite's schema-validation checks otherwise.
    (request as typeof request & { user: { sub: string; roles: string[] } }).user = {
      sub: 'teacher-1',
      roles,
    };
  });
  await registerAttendanceRoutes(app, { attendanceService });
  await registerAttendanceOpsRoutes(app, { opsService });
  await app.ready();
  return app;
}

describe('PRC-L277: leave-request attachmentUrl scheme + UUID identifiers', () => {
  it('rejects a javascript: attachmentUrl with 400 (failing-first: used to pass)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/attendance/leave-requests',
      payload: {
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        academicPeriodId: PERIOD_ID,
        fromDate: '2026-06-10',
        toDate: '2026-06-12',
        attachmentUrl: 'javascript:alert(1)',
      },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('rejects a data: attachmentUrl with 400', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/attendance/leave-requests',
      payload: {
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        academicPeriodId: PERIOD_ID,
        fromDate: '2026-06-10',
        toDate: '2026-06-12',
        attachmentUrl: 'data:text/html,<script>alert(1)</script>',
      },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('accepts an https:// attachmentUrl', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/attendance/leave-requests',
      payload: {
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        academicPeriodId: PERIOD_ID,
        fromDate: '2026-06-10',
        toDate: '2026-06-12',
        attachmentUrl: 'https://files.example.com/leave/note.pdf',
      },
    });
    expect(response.statusCode).toBe(201);
    await app.close();
  });

  it('rejects a non-UUID studentId with 400 (failing-first: used to pass as any non-empty string)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/attendance/leave-requests',
      payload: {
        studentId: 'not-a-uuid',
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        academicPeriodId: PERIOD_ID,
        fromDate: '2026-06-10',
        toDate: '2026-06-12',
      },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('rejects a non-UUID studentId/institutionId/classId on regularisation requests', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/attendance/regularisation',
      payload: {
        studentId: 'not-a-uuid',
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        attendanceDate: '2026-06-10',
        toStatus: 'PRESENT',
      },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe('PRC-L277: device registration + ingest identifiers must be UUIDs', () => {
  const event = {
    eventId: 'evt-1',
    studentId: STUDENT_ID,
    punchedAt: '2026-06-10T08:00:00.000Z',
    type: 'IN',
    classId: CLASS_ID,
    academicPeriodId: PERIOD_ID,
  };

  it('rejects a non-UUID institutionId on device registration with 400', async () => {
    const app = await buildApp(['registrar']);
    const response = await app.inject({
      method: 'POST',
      url: '/attendance/devices',
      payload: { institutionId: 'school-1', deviceId: DEVICE_ID },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it.each([
    ['institutionId', { institutionId: 'school-1' }],
    ['studentId', { events: [{ ...event, studentId: 'card-0042' }] }],
    ['classId', { events: [{ ...event, classId: 'class-7a' }] }],
    ['academicPeriodId', { events: [{ ...event, academicPeriodId: '2026' }] }],
  ])('rejects a non-UUID %s on ingest with 400 before device auth', async (_field, patch) => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/attendance/ingest',
      headers: { 'x-device-api-key': 'any-key' },
      payload: { deviceId: DEVICE_ID, institutionId: INSTITUTION_ID, events: [event], ...patch },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('accepts UUID identifiers (free-form device/event ids) and reaches device auth', async () => {
    const app = await buildApp(['registrar']);
    const registered = await app.inject({
      method: 'POST',
      url: '/attendance/devices',
      payload: { institutionId: INSTITUTION_ID, deviceId: DEVICE_ID },
    });
    expect(registered.statusCode).toBe(201);
    const ingest = await app.inject({
      method: 'POST',
      url: '/attendance/ingest',
      headers: { 'x-device-api-key': 'unknown-key' },
      payload: { deviceId: DEVICE_ID, institutionId: INSTITUTION_ID, events: [event] },
    });
    expect(ingest.statusCode).toBe(401);
    await app.close();
  });
});

describe('PRC-L277: IngestBatchSchema.events bulk size cap (verify-only, no code change)', () => {
  it('already enforces maxItems: 500 — 501 events fails validation', () => {
    const events = Array.from({ length: 501 }, (_, i) => ({
      eventId: `evt-${i}`,
      studentId: STUDENT_ID,
      punchedAt: '2026-06-10T08:00:00.000Z',
      type: 'IN' as const,
    }));
    const result = validate(IngestBatchSchema, {
      deviceId: DEVICE_ID,
      institutionId: INSTITUTION_ID,
      events,
    });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 500 events', () => {
    const events = Array.from({ length: 500 }, (_, i) => ({
      eventId: `evt-${i}`,
      studentId: STUDENT_ID,
      punchedAt: '2026-06-10T08:00:00.000Z',
      type: 'IN' as const,
    }));
    const result = validate(IngestBatchSchema, {
      deviceId: DEVICE_ID,
      institutionId: INSTITUTION_ID,
      events,
    });
    expect(result.success).toBe(true);
  });
});
