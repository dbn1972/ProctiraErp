/**
 * Unit smoke for Pg counselling store against live DATABASE_URL (skipped otherwise).
 */
import { randomUUID } from 'node:crypto';

import { withPgTenant } from '@proctira/database';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createPgCounsellingStore,
  getSharedCounsellingPool,
  isPgCounsellingEnabled,
} from './pg-counselling-store.js';
import { isPhiCiphertext } from './phi-crypto.js';

describe('PgCounsellingStore', () => {
  const previousKey = process.env.PHI_ENCRYPTION_KEY;
  afterEach(() => {
    if (previousKey === undefined) delete process.env.PHI_ENCRYPTION_KEY;
    else process.env.PHI_ENCRYPTION_KEY = previousKey;
  });

  // G-711: case notes are ciphertext at rest and transparent through the store.
  it.skipIf(!isPgCounsellingEnabled())('encrypts reason/case notes/outcome at rest', async () => {
    process.env.PHI_ENCRYPTION_KEY = 'd'.repeat(64);
    const store = createPgCounsellingStore()!;
    const tenantId = randomUUID();
    const id = randomUUID();
    await store.create({
      id,
      tenantId,
      studentId: randomUUID(),
      counsellorId: randomUUID(),
      sessionDate: '2026-09-06',
      sessionType: 'individual',
      reason: 'anxiety about exams',
      caseNotes: 'confidential case notes',
      outcome: 'referred',
      followUpRequired: false,
      followUpDate: null,
      status: 'completed',
    });

    const raw = await withPgTenant(getSharedCounsellingPool()!, tenantId, (c) =>
      c.query('SELECT reason, case_notes, outcome FROM counselling_sessions WHERE id = $1', [id]),
    );
    const row = raw.rows[0] as { reason: string; case_notes: string; outcome: string };
    expect(isPhiCiphertext(row.reason)).toBe(true);
    expect(isPhiCiphertext(row.case_notes)).toBe(true);
    expect(isPhiCiphertext(row.outcome)).toBe(true);
    expect(row.case_notes).not.toContain('confidential');

    const read = await store.findById(id, tenantId);
    expect(read?.caseNotes).toBe('confidential case notes');
    expect(read?.reason).toBe('anxiety about exams');
    expect(read?.outcome).toBe('referred');
  });

  it.skipIf(!isPgCounsellingEnabled())('creates and lists a counselling session', async () => {
    const store = createPgCounsellingStore();
    expect(store).not.toBeNull();
    const tenantId = randomUUID();
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
