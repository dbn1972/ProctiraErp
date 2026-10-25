/**
 * PRC-M229/PRC-M509 — live Postgres: exam-ops audit records must be durably
 * persisted, not silently discarded. `PgExamOpsStore.appendAudit` used to be
 * `return record;` (no write at all) and `listAudits` was `return [];`
 * (permanent no-op) — so every G-908 ops mutation (session create,
 * invigilator allocate, marks entry/resolve, re-evaluation) appeared
 * audited at the service layer (the in-memory `localAudits` array still
 * recorded it) but left zero rows in the durable `audit_log_entries` table,
 * and `ExamOpsService.listAudits()` against a fresh process/store would
 * return nothing even though mutations had happened.
 */
import { randomUUID } from 'node:crypto';

import { getSharedPgPool, withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';

import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { ExamOpsService } from './ops-service.js';
import { PgExamOpsStore } from './ops-store.js';
import { ExaminationService } from './examination-service.js';
import type { CreateExaminationInput } from './schemas.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-ops-audit-persistence.live.test' });
const pool = DATABASE_URL ? getSharedPgPool(DATABASE_URL) : null;
const live = Boolean(DATABASE_URL) && pool !== null;

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function examBody(): CreateExaminationInput {
  return {
    name: 'Ops Audit Live Exam',
    code: `OA-${randomUUID().slice(0, 8).toUpperCase()}`,
    academicPeriodId: randomUUID(),
    startDate: futureDate(7),
    endDate: futureDate(9),
    subjects: [{ name: 'Mathematics', code: 'MATH', maxScore: 100 }],
    centers: [{ name: 'Center A', code: 'CTR-A', institutionId: randomUUID(), capacity: 50 }],
    gradingSchemes: [
      {
        name: 'Standard',
        minScore: 0,
        maxScore: 100,
        passThreshold: 40,
        thresholds: [
          { grade: 'A', minScore: 80, maxScore: 100 },
          { grade: 'F', minScore: 0, maxScore: 79 },
        ],
      },
    ],
  };
}

describe('exam ops audit persistence (live Postgres, PRC-M229/PRC-M509)', () => {
  it.skipIf(!live)(
    'appendAudit writes a durable audit_log_entries row and listAudits reads it back',
    async () => {
      const tenantId = randomUUID();
      await ensurePgTestTenant(pool!, tenantId);
      const repository = new InMemoryExaminationRepository();
      const store = new PgExamOpsStore(pool!);
      const exams = new ExaminationService(repository);
      const ops = new ExamOpsService({ store, examinations: repository });
      const actor = { userId: randomUUID(), roles: ['Administrator'] };

      const exam = await exams.create(tenantId, examBody());
      const subjectId = exam.subjects[0]!.id;

      const outcome = await ops.createSession(
        tenantId,
        exam.id,
        {
          subjectId,
          date: futureDate(8),
          startTime: '09:00',
          endTime: '11:00',
          roomId: 'ROOM-1',
        },
        actor,
      );
      if (!outcome.ok) throw new Error('session creation unexpectedly conflicted');

      // The durable table must contain exactly one row for this audit, scoped
      // by tenant + the examinationId carried in `metadata` (PgExamOpsStore's
      // only way to filter, since audit_log_entries has no examination_id column).
      // audit_log_entries has FORCE ROW LEVEL SECURITY, so the read must bind
      // app.tenant_id via withPgTenant the same way PgExamOpsStore's own writes do.
      const { rows } = await withPgTenant(pool!, tenantId, (client) =>
        client.query(
          `SELECT * FROM audit_log_entries WHERE tenant_id = $1 AND metadata->>'examinationId' = $2`,
          [tenantId, exam.id],
        ),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        tenant_id: tenantId,
        entity_type: 'exam_session',
        entity_id: outcome.session.id,
        operation: 'CREATE',
        user_id: actor.userId,
      });
      expect(rows[0].metadata).toMatchObject({ action: 'session.create', examinationId: exam.id });

      // listAudits (via the service, which merges durable + in-memory) returns it.
      const audits = await ops.listAudits(tenantId, exam.id);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        tenantId,
        examinationId: exam.id,
        action: 'session.create',
        entityType: 'exam_session',
        entityId: outcome.session.id,
        actorId: actor.userId,
      });

      // Reading directly from the store (bypassing the in-memory merge) proves
      // the durable persistence, not just the service's local cache.
      const storeAudits = await store.listAudits(tenantId, exam.id);
      expect(storeAudits).toHaveLength(1);
      expect(storeAudits[0]).toMatchObject({
        action: 'session.create',
        entityType: 'exam_session',
        entityId: outcome.session.id,
      });
    },
  );
});
