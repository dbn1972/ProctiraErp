/**
 * Unit smoke for Pg nurse incident store against live DATABASE_URL (skipped otherwise).
 */
import { randomUUID } from 'node:crypto';

import { withPgTenant } from '@proctira/database';
import { afterEach, describe, expect, it } from 'vitest';

import { getSharedCounsellingPool } from './pg-counselling-store.js';
import { createPgNurseIncidentStore, isPgNurseIncidentEnabled } from './pg-nurse-incident-store.js';
import { isPhiCiphertext } from './phi-crypto.js';

describe('PgNurseIncidentStore', () => {
  const previousKey = process.env.PHI_ENCRYPTION_KEY;
  afterEach(() => {
    if (previousKey === undefined) delete process.env.PHI_ENCRYPTION_KEY;
    else process.env.PHI_ENCRYPTION_KEY = previousKey;
  });

  it.skipIf(!isPgNurseIncidentEnabled())('encrypts incident notes at rest', async () => {
    process.env.PHI_ENCRYPTION_KEY = 'e'.repeat(64);
    const store = createPgNurseIncidentStore()!;
    const tenantId = randomUUID();
    const id = randomUUID();
    await store.create({
      id,
      tenantId,
      studentId: randomUUID(),
      institutionId: null,
      incidentAt: new Date('2026-09-06T10:00:00.000Z'),
      category: 'clinic_visit',
      severity: 'medium',
      notes: 'confidential nurse visit notes',
      reportedBy: 'Nurse Test',
    });

    const raw = await withPgTenant(getSharedCounsellingPool()!, tenantId, (c) =>
      c.query('SELECT notes FROM health_nurse_incidents WHERE id = $1', [id]),
    );
    const row = raw.rows[0] as { notes: string };
    expect(isPhiCiphertext(row.notes)).toBe(true);
    expect(row.notes).not.toContain('confidential');

    const read = (await store.listByTenant(tenantId)).find((r) => r.id === id);
    expect(read?.notes).toBe('confidential nurse visit notes');
  });
});
