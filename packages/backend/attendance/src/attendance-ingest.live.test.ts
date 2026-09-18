/**
 * W3-TEST-01 — live Postgres invariants for device ingest idempotency (G-919).
 * Attendance rows stay in-memory; device keys + ingest events use PgAttendanceOpsStore.
 */
import { randomUUID } from 'node:crypto';

import { getSharedPgPool } from '@proctira/database';
import { ensurePgTestStudent, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';

import { InMemoryAttendanceRepository } from './in-memory-repository.js';
import { AttendanceOpsService } from './ops-service.js';
import { PgAttendanceOpsStore } from './ops-store.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'attendance-ingest.live.test' });
const pool = DATABASE_URL ? getSharedPgPool(DATABASE_URL) : null;
const live = Boolean(DATABASE_URL) && pool !== null;

describe('attendance device ingest (live Postgres)', () => {
  it.skipIf(!live)('registerDevice → ingest twice is idempotent on deviceId+eventId', async () => {
    const tenantId = randomUUID();
    const institutionId = randomUUID();
    const studentId = randomUUID();
    const deviceId = `gate-${randomUUID().slice(0, 8)}`;
    const eventId = `evt-${randomUUID().slice(0, 8)}`;
    await ensurePgTestStudent(pool!, tenantId, studentId);

    const repo = new InMemoryAttendanceRepository();
    const store = new PgAttendanceOpsStore(pool!);
    const ops = new AttendanceOpsService(store, repo);

    const registered = await ops.registerDevice(
      tenantId,
      { institutionId, deviceId, label: 'Live gate' },
      { userId: randomUUID(), roles: ['admin'] },
    );
    expect(registered.apiKey.length).toBeGreaterThan(8);

    const payload = {
      deviceId,
      institutionId,
      events: [
        {
          eventId,
          studentId,
          punchedAt: '2026-09-13T08:05:00.000Z',
          type: 'IN' as const,
          // Omit class/period so we only exercise ingest-event uniqueness.
        },
      ],
    };

    const first = await ops.ingest(tenantId, registered.apiKey, payload);
    expect(first.accepted).toBe(1);
    expect(first.duplicates).toBe(0);
    expect(first.events[0]?.duplicate).toBe(false);

    const second = await ops.ingest(tenantId, registered.apiKey, payload);
    expect(second.accepted).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(second.events[0]?.duplicate).toBe(true);

    const stored = await store.findIngestEvent(tenantId, deviceId, eventId);
    expect(stored).not.toBeNull();
    expect(stored?.studentId).toBe(studentId);
    expect(stored?.duplicate).toBe(false);
  });

  it.skipIf(!live)('rejects ingest with an unknown device API key', async () => {
    const tenantId = randomUUID();
    const institutionId = randomUUID();
    const deviceId = `gate-${randomUUID().slice(0, 8)}`;
    await ensurePgTestTenant(pool!, tenantId);
    const repo = new InMemoryAttendanceRepository();
    const store = new PgAttendanceOpsStore(pool!);
    const ops = new AttendanceOpsService(store, repo);

    await ops.registerDevice(
      tenantId,
      { institutionId, deviceId, label: 'Live gate' },
      { userId: randomUUID(), roles: ['admin'] },
    );

    await expect(
      ops.ingest(tenantId, 'not-a-real-key', {
        deviceId,
        institutionId,
        events: [
          {
            eventId: 'evt-denied',
            studentId: randomUUID(),
            punchedAt: '2026-09-13T08:05:00.000Z',
            type: 'IN',
          },
        ],
      }),
    ).rejects.toThrow(/api key|unauthorized|invalid/i);
  });
});
