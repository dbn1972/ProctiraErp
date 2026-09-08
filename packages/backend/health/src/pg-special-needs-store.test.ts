/**
 * Live DATABASE_URL smoke for special-needs PG store (G-203).
 * Skips when DATABASE_URL is unset.
 */
import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';
import { withPgTenant } from '@proctira/database';
import type pg from 'pg';

import {
  createPgSpecialNeedsStore,
  isPgSpecialNeedsEnabled,
  type PgSpecialNeedsStore,
} from './pg-special-needs-store.js';

function getPool(store: PgSpecialNeedsStore): pg.Pool {
  return (store as unknown as { pool: pg.Pool }).pool;
}

describe('PgSpecialNeedsStore', () => {
  const previousKey = process.env.PHI_ENCRYPTION_KEY;

  afterEach(() => {
    if (previousKey === undefined) {
      delete process.env.PHI_ENCRYPTION_KEY;
    } else {
      process.env.PHI_ENCRYPTION_KEY = previousKey;
    }
  });

  it.skipIf(!isPgSpecialNeedsEnabled())(
    'creates assessment with tenant isolation and encrypted findings when key set',
    async () => {
      process.env.PHI_ENCRYPTION_KEY = 'g203-special-needs-test-key';
      const store = createPgSpecialNeedsStore();
      expect(store).not.toBeNull();

      const tenantA = '00000000-0000-4000-8000-0000000000aa';
      const tenantB = '00000000-0000-4000-8000-0000000000bb';
      const studentId = randomUUID();
      const assessmentId = randomUUID();
      const findingsPlain = `IEP findings ${assessmentId}`;

      const created = await store!.createAssessment({
        id: assessmentId,
        tenantId: tenantA,
        studentId,
        assessmentDate: '2026-09-01',
        assessorName: 'Dr. Test',
        assessorRole: 'psychologist',
        assessmentType: 'cognitive',
        findings: findingsPlain,
        recommendations: 'extra time',
      });
      expect(created.id).toBe(assessmentId);
      expect(created.findings).toBe(findingsPlain);

      const listedA = await store!.listAssessmentsByStudent(tenantA, studentId, {
        page: 1,
        pageSize: 20,
      });
      expect(listedA.data.some((row) => row.id === assessmentId)).toBe(true);

      const listedB = await store!.listAssessmentsByStudent(tenantB, studentId, {
        page: 1,
        pageSize: 20,
      });
      expect(listedB.data).toHaveLength(0);

      const found = await store!.findAssessmentById(assessmentId, tenantA);
      expect(found?.findings).toBe(findingsPlain);

      await store!.logPhiAccess({
        tenantId: tenantA,
        actorUserId: 'nurse-1',
        studentId,
        resourceType: 'special_needs_assessment',
        resourceId: assessmentId,
      });

      const raw = await withPgTenant(getPool(store!), tenantA, async (client) => {
        const result = await client.query(
          `SELECT findings FROM health_special_needs_assessments WHERE id = $1`,
          [assessmentId],
        );
        return String((result.rows[0] as { findings: string }).findings);
      });
      expect(raw.startsWith('enc:v1:')).toBe(true);
      expect(raw).not.toContain(findingsPlain);
    },
  );
});
