/**
 * Unit smoke for Pg counselling store against live DATABASE_URL (skipped otherwise).
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createPgCounsellingStore,
  isPgCounsellingEnabled,
} from './pg-counselling-store.js';

describe('PgCounsellingStore', () => {
  it.skipIf(!isPgCounsellingEnabled())('creates and lists a counselling session', async () => {
    const store = createPgCounsellingStore();
    expect(store).not.toBeNull();
    const tenantId = '00000000-0000-4000-8000-0000000000aa';
    const studentId = randomUUID();
    const id = randomUUID();
    const created = await store!.create({
      id,
      tenantId,
      studentId,
      counsellorId: randomUUID(),
      sessionDate: '2026-09-06',
      sessionType: 'individual',
      reason: 'Unit test session',
      caseNotes: 'pg store proof',
      outcome: null,
      followUpRequired: false,
      followUpDate: null,
      status: 'scheduled',
    });
    expect(created.id).toBe(id);
    const listed = await store!.listByTenant(tenantId);
    expect(listed.some((row) => row.id === id)).toBe(true);
  });
});
