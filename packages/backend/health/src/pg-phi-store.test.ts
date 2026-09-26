/**
 * Unit smoke for Pg PHI store against live DATABASE_URL (skipped otherwise).
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createPgPhiStore, isPgPhiEnabled } from './pg-phi-store.js';
import { HybridHealthRepository } from './create-health-repository.js';
import { InMemoryHealthRepository } from './in-memory-repository.js';

describe('PgPhiStore', () => {
  it.skipIf(!isPgPhiEnabled())('creates allergy and screening with tenant isolation', async () => {
    const store = createPgPhiStore();
    expect(store).not.toBeNull();
    const tenantA = '00000000-0000-4000-8000-0000000000aa';
    const tenantB = '00000000-0000-4000-8000-0000000000bb';
    const studentId = randomUUID();
    const allergyId = randomUUID();
    const screeningId = randomUUID();

    await store!.createAllergy({
      id: allergyId,
      tenantId: tenantA,
      studentId,
      allergyType: 'food',
      description: 'Peanuts',
      severity: 'severe',
      reaction: 'anaphylaxis',
      treatment: 'epinephrine',
      diagnosedDate: '2026-01-01',
    });

    await store!.createScreeningProgram({
      id: screeningId,
      tenantId: tenantA,
      name: 'Grade 5 vision',
      description: 'Annual vision screen',
      gradeLevel: '5',
      academicPeriodId: randomUUID(),
      assessmentTypes: ['vision'],
      scheduledDate: '2026-09-15',
      status: 'scheduled',
    });

    const allergiesA = await store!.listAllergiesByStudent(tenantA, studentId, {
      page: 1,
      pageSize: 20,
    });
    expect(allergiesA.data.some((row) => row.id === allergyId)).toBe(true);

    const allergiesB = await store!.listAllergiesByStudent(tenantB, studentId, {
      page: 1,
      pageSize: 20,
    });
    expect(allergiesB.data).toHaveLength(0);

    const screeningsB = await store!.listScreeningPrograms(tenantB, { page: 1, pageSize: 20 });
    expect(screeningsB.data.some((row) => row.id === screeningId)).toBe(false);

    // G-912 tenant-wide reads behind the /health list aggregates.
    const allA = await store!.listAllAllergies(tenantA);
    expect(allA.some((row) => row.id === allergyId)).toBe(true);
    const allB = await store!.listAllAllergies(tenantB);
    expect(allB.some((row) => row.id === allergyId)).toBe(false);
  });

  /**
   * W1-SEC: screening programs previously had no delete path anywhere in
   * this store — this proves the new deleteScreeningProgram both respects
   * tenant isolation (cross-tenant delete is a no-op, matching the
   * cross-tenant read isolation proven above) and shares one COMMIT with
   * its audit entry, mirroring the create-path guarantee already covered
   * by phi-write-txn-audit.test.ts.
   */
  it.skipIf(!isPgPhiEnabled())(
    'deleteScreeningProgram is tenant-isolated and audits in the same txn',
    async () => {
      const store = createPgPhiStore();
      expect(store).not.toBeNull();
      const tenantA = '00000000-0000-4000-8000-0000000000aa';
      const tenantB = '00000000-0000-4000-8000-0000000000bb';
      const screeningId = randomUUID();

      const created = await store!.createScreeningProgram({
        id: screeningId,
        tenantId: tenantA,
        name: 'Grade 3 hearing',
        description: 'Annual hearing screen',
        gradeLevel: '3',
        academicPeriodId: randomUUID(),
        assessmentTypes: ['hearing'],
        scheduledDate: '2026-10-01',
        status: 'scheduled',
      });
      expect(created.id).toBe(screeningId);

      // Cross-tenant delete: tenant B cannot delete tenant A's row.
      const deletedByWrongTenant = await store!.deleteScreeningProgram(screeningId, tenantB);
      expect(deletedByWrongTenant).toBe(false);
      const stillThere = await store!.findScreeningProgramById(screeningId, tenantA);
      expect(stillThere?.id).toBe(screeningId);

      // Not-found: deleting a random id in the correct tenant is also a no-op.
      const deletedMissing = await store!.deleteScreeningProgram(randomUUID(), tenantA);
      expect(deletedMissing).toBe(false);

      // Same-tenant delete succeeds and commits an audit entry with the
      // same client used for the DELETE (mirrors the create-path pattern).
      const auditCalls: Array<{ id: string }> = [];
      const deleted = await store!.deleteScreeningProgram(screeningId, tenantA, {
        appendAuditInTxn: async (_client, entity) => {
          auditCalls.push({ id: entity.id });
        },
      });
      expect(deleted).toBe(true);
      expect(auditCalls).toEqual([{ id: screeningId }]);

      const goneNow = await store!.findScreeningProgramById(screeningId, tenantA);
      expect(goneNow).toBeNull();
    },
  );
});

describe('HybridHealthRepository persistence flag', () => {
  it('reports memory when no PG stores are wired', () => {
    const hybrid = new HybridHealthRepository(new InMemoryHealthRepository(), null, null);
    expect(hybrid.persistence).toBe('memory');
  });
});
