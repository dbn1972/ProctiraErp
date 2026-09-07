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
  });
});

describe('HybridHealthRepository persistence flag', () => {
  it('reports memory when no PG stores are wired', () => {
    const hybrid = new HybridHealthRepository(new InMemoryHealthRepository(), null, null);
    expect(hybrid.persistence).toBe('memory');
  });
});
