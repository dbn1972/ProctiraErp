/**
 * PRC-M206 (b) — exam room double-booking is impossible at the database level, on a real,
 * migrated Postgres (runtime app role, RLS enforced).
 *
 * The room clash rule lived only in app code (findRoomClashes under an advisory lock;
 * db/sql/222 is a lookup index, explicitly not an EXCLUDE). Any writer that skipped the
 * lock could double-book a room. db/sql/267 adds
 *   exam_sessions_room_overlap_excl EXCLUDE USING gist
 *     (tenant_id WITH =, room_id WITH =, tsrange(date + start, date + end, '[)') WITH &&)
 * — the same half-open overlap as clash.ts sessionsOverlap. PgExamOpsStore maps the
 * resulting 23P01 to the existing room_overlap conflict result (409 response).
 *
 * Fails closed when CI=true or REQUIRE_LIVE_TESTS=1 and DATABASE_URL is unset (W3-TEST-03).
 */
import { randomUUID } from 'node:crypto';
import {
  closeSharedPgPools,
  getSharedPgPool,
  withPgTenant,
  type PgPoolWithConnect,
  type PgQueryable,
} from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgExamOpsStore, type ExamSessionRecord } from './ops-store.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'exam-room-overlap-exclusion.live.test' });

describe.skipIf(!DATABASE_URL)('PRC-M206 exam room overlap exclusion (live)', () => {
  let pool: PgPoolWithConnect;
  let store: PgExamOpsStore;

  beforeAll(() => {
    pool = getSharedPgPool(DATABASE_URL) as PgPoolWithConnect;
    store = new PgExamOpsStore(pool);
  });

  afterAll(async () => {
    await closeSharedPgPools();
  });

  function session(tenantId: string, start: string, end: string, roomId = 'HALL-1') {
    const now = new Date();
    return {
      id: randomUUID(),
      tenantId,
      examinationId: randomUUID(),
      subjectId: randomUUID(),
      date: '2026-11-02',
      startTime: start,
      endTime: end,
      roomId,
      centerId: null,
      createdAt: now,
      updatedAt: now,
    } satisfies ExamSessionRecord;
  }

  function insertDirect(client: PgQueryable, s: ExamSessionRecord) {
    return client.query(
      `INSERT INTO exam_sessions
         (id, tenant_id, examination_id, subject_id, session_date, start_time, end_time, room_id)
       VALUES ($1, $2, $3, $4, $5::date, $6::time, $7::time, $8)`,
      [s.id, s.tenantId, s.examinationId, s.subjectId, s.date, s.startTime, s.endTime, s.roomId],
    );
  }

  it('a direct overlapping insert that bypasses the advisory lock fails with 23P01', async () => {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    await withPgTenant(pool, tenantId, async (client) => {
      await insertDirect(client, session(tenantId, '09:00', '11:00'));
    });
    await expect(
      withPgTenant(pool, tenantId, (client) =>
        insertDirect(client, session(tenantId, '10:30', '12:00')),
      ),
    ).rejects.toMatchObject({ code: '23P01' });
  });

  it('back-to-back sessions, other rooms and other tenants are not clashes', async () => {
    const tenantId = randomUUID();
    const other = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    await ensurePgTestTenant(pool, other);
    await withPgTenant(pool, tenantId, async (client) => {
      await insertDirect(client, session(tenantId, '09:00', '11:00'));
      await insertDirect(client, session(tenantId, '11:00', '12:00'));
      await insertDirect(client, session(tenantId, '09:00', '11:00', 'HALL-2'));
    });
    await withPgTenant(pool, other, (client) =>
      insertDirect(client, session(other, '09:00', '11:00')),
    );
  });

  it('createSessionGuarded reports a raced 23P01 as the room_overlap conflict, not a 500', async () => {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    // An uncommitted writer that skipped the advisory lock holds an overlapping row.
    const racer = await pool.connect();
    try {
      await racer.query('BEGIN');
      await racer.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await insertDirect(racer, session(tenantId, '09:00', '11:00'));
      const guarded = store.createSessionGuarded(session(tenantId, '10:00', '10:45'));
      // Let the guarded insert reach the exclusion wait, then commit the racer.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await racer.query('COMMIT');
      const outcome = await guarded;
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.conflicts[0]).toMatchObject({ kind: 'room_overlap', roomId: 'HALL-1' });
      }
    } finally {
      racer.release();
    }
  });
});
