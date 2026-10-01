/**
 * PRC-L361: certificate expiry is exact calendar-day arithmetic regardless of host TZ;
 * program range edits cannot orphan sessions; explicit one-active-cert re-issue rule.
 */
import { BusinessRuleError, ConflictError } from '@proctira/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  InMemoryCertificationRepository,
  InMemoryTrainingAttendanceRepository,
  InMemoryTrainingProgramRepository,
  InMemoryTrainingSessionRepository,
} from './in-memory-training-repository.js';
import { TrainingService, addUtcDays } from './training-service.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';
const STAFF = '770e8400-e29b-41d4-a716-446655440002';

function newService() {
  return new TrainingService(
    new InMemoryTrainingProgramRepository(),
    new InMemoryTrainingSessionRepository(),
    new InMemoryTrainingAttendanceRepository(),
    new InMemoryCertificationRepository(),
  );
}

describe('PRC-L361 certificate expiry across DST', () => {
  const originalTz = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'America/New_York';
  });
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it('addUtcDays is exact across the US spring-forward and fall-back boundaries', () => {
    expect(addUtcDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addUtcDays('2026-03-07', 2)).toBe('2026-03-09');
    expect(addUtcDays('2026-10-31', 2)).toBe('2026-11-02');
    expect(addUtcDays('2026-01-01', 365)).toBe('2027-01-01');
    expect(addUtcDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('issued cert expiry = issuedDate + N days exactly (TZ=America/New_York, across DST)', async () => {
    const service = newService();
    const program = await service.createProgram(TENANT, {
      name: 'First aid',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      certificationValidityDays: 10,
    });
    const cert = await service.issueCertification(TENANT, {
      staffId: STAFF,
      programId: program.id,
      certificationName: 'First aid',
      issuedDate: '2026-03-01',
    });
    expect(cert.expiryDate).toBe('2026-03-11');
  });
});

describe('PRC-L361 program/session reconciliation and re-issue', () => {
  it('updating a program to exclude an existing session -> 422', async () => {
    const service = newService();
    const program = await service.createProgram(TENANT, {
      name: 'P',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    await service.createSession(TENANT, { programId: program.id, title: 'S', date: '2026-06-15' });
    const err = await service
      .updateProgram(TENANT, program.id, { endDate: '2026-05-31' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BusinessRuleError);
    expect((err as BusinessRuleError).statusCode).toBe(422);
    // A range that still contains the session is fine.
    const ok = await service.updateProgram(TENANT, program.id, { endDate: '2026-06-30' });
    expect(ok.endDate).toBe('2026-06-30');
  });

  it('a second ACTIVE certification for the same staff+program -> 409', async () => {
    const service = newService();
    const program = await service.createProgram(TENANT, {
      name: 'P',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    const input = {
      staffId: STAFF,
      programId: program.id,
      certificationName: 'C',
      issuedDate: '2026-02-01',
      expiryDate: '2026-03-01',
    };
    await service.issueCertification(TENANT, input);
    await expect(service.issueCertification(TENANT, input)).rejects.toBeInstanceOf(ConflictError);
    // After expiry processing, re-issue is allowed.
    await service.processExpiredCertifications(TENANT, '2026-03-02');
    await expect(
      service.issueCertification(TENANT, {
        ...input,
        issuedDate: '2026-03-02',
        expiryDate: undefined,
      }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
  });
});
