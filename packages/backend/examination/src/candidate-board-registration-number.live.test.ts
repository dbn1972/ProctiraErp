/**
 * PRC-L036 — live Postgres proof that an examination candidate registration
 * stores the board-issued registration number
 * (examination_candidate_registrations.board_registration_number, Prisma
 * migration 20261126_prc_l036_candidate_board_registration_number).
 *
 * Before: the candidate record had no such field, so the candidates page could
 * only show a fragment of the registration UUID. After: the number recorded at
 * registration is persisted and returned on the candidate list; a candidate
 * registered without one reads back null ("not recorded").
 */
import { randomUUID } from 'node:crypto';
import { getSharedPgPool } from '@proctira/database';
import { ensurePgTestStudent } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';
import { createExaminationRepository } from './repository-factory.js';

const DATABASE_URL = requireLiveDatabaseUrl({
  suite: 'candidate-board-registration-number.live.test',
});
const pool = DATABASE_URL ? getSharedPgPool(DATABASE_URL) : null;
const live = Boolean(DATABASE_URL) && pool !== null;

describe('PRC-L036 candidate board registration number (live)', () => {
  it.skipIf(!live)('persists and lists the board-issued registration number', async () => {
    const tenantId = randomUUID();
    const withNumber = randomUUID();
    const withoutNumber = randomUUID();
    await ensurePgTestStudent(pool!, tenantId, withNumber);
    await ensurePgTestStudent(pool!, tenantId, withoutNumber);
    const repo = createExaminationRepository({ databaseUrl: DATABASE_URL! });
    const examinationId = randomUUID();
    const base = {
      examinationId,
      tenantId,
      centerId: randomUUID(),
      subjectIds: [randomUUID()],
      status: 'REGISTERED' as const,
      registeredAt: new Date('2026-11-01T09:00:00.000Z'),
    };
    const created = await repo.createCandidateRegistration({
      ...base,
      id: randomUUID(),
      studentId: withNumber,
      boardRegistrationNumber: 'B/2026/0012345',
    });
    expect(created.boardRegistrationNumber).toBe('B/2026/0012345');
    await repo.createCandidateRegistration({
      ...base,
      id: randomUUID(),
      studentId: withoutNumber,
      registeredAt: new Date('2026-11-01T09:05:00.000Z'),
    });
    const listed = await repo.listCandidateRegistrations(examinationId, tenantId);
    expect(listed.map((r) => [r.studentId, r.boardRegistrationNumber])).toEqual([
      [withNumber, 'B/2026/0012345'],
      [withoutNumber, null],
    ]);
    const found = await repo.findCandidateRegistration(examinationId, withNumber, tenantId);
    expect(found?.boardRegistrationNumber).toBe('B/2026/0012345');
  });
});
