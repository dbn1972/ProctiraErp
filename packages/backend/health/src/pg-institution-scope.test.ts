/**
 * PRC-L563 — live-Postgres institution-scope isolation test for health PHI.
 *
 * Net-new coverage (not a failing-first fix for an existing bug): asserts
 * that HealthService.getMeasurement / listAllergiesByStudent, backed by the
 * live PgPhiStore, enforce institution scoping for a school-bound role
 * (`school_nurse`) the same way the in-memory-repository unit tests already
 * prove for the pure access-control predicate.
 *
 * Gated with it.skipIf(!isPgPhiEnabled()) matching the existing live-test
 * pattern in pg-phi-store.ts / pg-nurse-incident-store.test.ts. Per the task
 * brief: before running, confirm the live-Postgres container is reachable
 * (docker ps --filter name=proctira-erp-postgres-1) and run migrations
 * first. The shared `proctira` scratch database currently has a
 * pre-existing broken migration (`20260908_wave7_rls_hardening` fails with
 * `relation "attendance_audit" does not exist`, P3009) — unrelated to this
 * FEAT and already flagged by FEAT-001's findings. `isPgPhiEnabled()` is
 * true whenever DATABASE_URL is set regardless of migration state, so this
 * suite still "runs" against a reachable-but-unmigrated database; the
 * schema-readiness guard inside PgPhiStore.ensureSchema() then throws
 * DatabaseSchemaNotReadyError for both assertions below, which is the
 * correct observable behavior (fail loud, not fabricate a pass) rather than
 * a skip. See FEAT-002's findings for which outcome actually occurred.
 */
import { randomUUID } from 'node:crypto';

import { withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { ForbiddenError } from '@proctira/common';
import { afterEach, describe, expect, it } from 'vitest';

import { HealthService } from './health-service.js';
import type { HealthAccessContext } from './health-service.js';
import { createPgPhiStore, isPgPhiEnabled, type PgPhiStore } from './pg-phi-store.js';
import { getSharedCounsellingPool } from './pg-counselling-store.js';
import { HybridHealthRepository } from './create-health-repository.js';
import { InMemoryHealthRepository } from './in-memory-repository.js';

async function seedInstitutionAndStudent(
  store: PgPhiStore,
  tenantId: string,
  institutionId: string,
  studentId: string,
): Promise<void> {
  const pool = getSharedCounsellingPool()!;
  const areaId = randomUUID();
  const gradeId = randomUUID();
  const classId = randomUUID();
  const academicPeriodId = randomUUID();
  const suffix = institutionId.slice(0, 8);
  await withPgTenant(pool, tenantId, async (client) => {
    await client.query(
      `INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
       VALUES ($1, $2, 'Root', $3, 0, NULL, '/', 1, 2)
       ON CONFLICT (id) DO NOTHING`,
      [areaId, tenantId, `ROOT-${suffix}`],
    );
    await client.query(
      `INSERT INTO institutions (id, tenant_id, name, code, area_id, type, sector, ownership, status)
       VALUES ($1, $2, 'L563 School', $3, $4, 'SCHOOL', 'PUBLIC', 'GOVERNMENT', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [institutionId, tenantId, `L563-${suffix}`, areaId],
    );
    await client.query(
      `INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date, status)
       VALUES ($1, $2, 'AY L563', $3, '2026-04-01', '2027-03-31', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [academicPeriodId, tenantId, `AY-L563-${suffix}`],
    );
    await client.query(
      `INSERT INTO grades (id, tenant_id, name, code, "order")
       VALUES ($1, $2, 'Grade 6', $3, 6)
       ON CONFLICT (id) DO NOTHING`,
      [gradeId, tenantId, `G6-L563-${suffix}`],
    );
    await client.query(
      `INSERT INTO classes (id, tenant_id, institution_id, grade_id, academic_period_id, name, capacity)
       VALUES ($1, $2, $3, $4, $5, '6-A', 40)
       ON CONFLICT (id) DO NOTHING`,
      [classId, tenantId, institutionId, gradeId, academicPeriodId],
    );
    await client.query(
      `INSERT INTO students (id, tenant_id, first_name, last_name, date_of_birth, gender, custom_data)
       VALUES ($1, $2, 'Live', 'Student', '2012-01-01', 'unspecified', '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [studentId, tenantId],
    );
    await client.query(
      `INSERT INTO enrollments (
         id, tenant_id, student_id, institution_id, grade_id, class_id,
         academic_period_id, status, enrolled_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'ENROLLED', CURRENT_DATE)
       ON CONFLICT (id) DO NOTHING`,
      [randomUUID(), tenantId, studentId, institutionId, gradeId, classId, academicPeriodId],
    );
  });
  void store;
}

describe('PRC-L563: live-Postgres institution-scope isolation', () => {
  const previousKey = process.env.PHI_ENCRYPTION_KEY;
  afterEach(() => {
    if (previousKey === undefined) delete process.env.PHI_ENCRYPTION_KEY;
    else process.env.PHI_ENCRYPTION_KEY = previousKey;
  });

  it.skipIf(!isPgPhiEnabled())(
    'school_nurse scoped to institution A can read student A but not student B (different institution)',
    async () => {
      process.env.PHI_ENCRYPTION_KEY = 'test-test-test-test-test-test-test-test';
      const phi = createPgPhiStore();
      expect(phi).not.toBeNull();

      const tenantId = randomUUID();
      const institutionA = randomUUID();
      const institutionB = randomUUID();
      const studentA = randomUUID();
      const studentB = randomUUID();

      await ensurePgTestTenant(getSharedCounsellingPool()!, tenantId);
      await seedInstitutionAndStudent(phi!, tenantId, institutionA, studentA);
      await seedInstitutionAndStudent(phi!, tenantId, institutionB, studentB);

      const measurementA = await phi!.createMeasurement({
        id: randomUUID(),
        tenantId,
        studentId: studentA,
        date: '2026-09-01',
        height: 140,
        weight: 35,
        bmi: null,
        bloodPressureSystolic: null,
        bloodPressureDiastolic: null,
        heartRate: null,
        visionLeft: null,
        visionRight: null,
        notes: null,
      });
      const measurementB = await phi!.createMeasurement({
        id: randomUUID(),
        tenantId,
        studentId: studentB,
        date: '2026-09-01',
        height: 150,
        weight: 45,
        bmi: null,
        bloodPressureSystolic: null,
        bloodPressureDiastolic: null,
        heartRate: null,
        visionLeft: null,
        visionRight: null,
        notes: null,
      });

      const repository = new HybridHealthRepository(
        new InMemoryHealthRepository(),
        null,
        phi,
        null,
        null,
        null,
      );
      const service = new HealthService(repository);

      // Simplest institution-scope context per the task brief: set
      // authoritativeInstitutionIds directly rather than seeding
      // staff_assignments + exercising findActorInstitutionAssignments.
      const nurseScopedToA: HealthAccessContext = {
        userId: 'nurse-a',
        roles: ['school_nurse'],
        guardianOfStudentIds: [],
        authoritativeInstitutionIds: [institutionA],
      };

      const readA = await service.getMeasurement(tenantId, measurementA.id, nurseScopedToA);
      expect(readA.id).toBe(measurementA.id);

      await expect(
        service.getMeasurement(tenantId, measurementB.id, nurseScopedToA),
      ).rejects.toThrow(ForbiddenError);

      const allergiesA = await service.listAllergies(
        tenantId,
        studentA,
        { page: 1, pageSize: 20 },
        nurseScopedToA,
      );
      expect(allergiesA.meta.totalItems).toBe(0);

      await expect(
        service.listAllergies(tenantId, studentB, { page: 1, pageSize: 20 }, nurseScopedToA),
      ).rejects.toThrow(ForbiddenError);
    },
  );
});
