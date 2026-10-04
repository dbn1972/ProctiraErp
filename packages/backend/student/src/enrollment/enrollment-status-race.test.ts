/**
 * PRC-L160: concurrent withdraw/graduate on the same enrollment must yield
 * exactly one success, one 409 ConflictError and a single history row.
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { ConflictError } from '@proctira/common';
import { InMemoryEnrollmentRepository } from './in-memory-enrollment-repository.js';
import { EnrollmentService } from './enrollment-service.js';
import { PgEnrollmentRepository } from './pg-enrollment-repository.js';

const TENANT_ID = randomUUID();
const INSTITUTION_ID = randomUUID();

describe('enrollment status transition race (PRC-L160)', () => {
  it('parallel withdraw + graduate: one succeeds, other 409, one history row', async () => {
    const repository = new InMemoryEnrollmentRepository();
    repository.addInstitution(INSTITUTION_ID, TENANT_ID, 'active');
    const service = new EnrollmentService(repository);
    const enrollment = await service.createEnrollment(TENANT_ID, {
      studentId: randomUUID(),
      institutionId: INSTITUTION_ID,
      gradeId: randomUUID(),
      classId: randomUUID(),
      academicPeriodId: randomUUID(),
      enrolledAt: '2024-01-15',
    });
    const before = (await repository.getHistoryByEnrollmentId(enrollment.id)).length;

    const results = await Promise.allSettled([
      service.updateEnrollmentStatus(TENANT_ID, enrollment.id, {
        status: 'WITHDRAWN',
        effectiveDate: '2024-06-01',
        reason: 'Relocated',
      }),
      service.updateEnrollmentStatus(TENANT_ID, enrollment.id, {
        status: 'GRADUATED',
        effectiveDate: '2024-06-01',
        reason: 'Completed',
      }),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toBeInstanceOf(ConflictError);
    expect((failed[0]!.reason as ConflictError).statusCode).toBe(409);
    const after = await repository.getHistoryByEnrollmentId(enrollment.id);
    expect(after.length - before).toBe(1);
  });

  it('pg repository locks the row and maps a lost compare-and-set to ConflictError', async () => {
    const id = randomUUID();
    const existing = {
      id,
      tenant_id: TENANT_ID,
      student_id: randomUUID(),
      institution_id: INSTITUTION_ID,
      grade_id: randomUUID(),
      class_id: randomUUID(),
      academic_period_id: randomUUID(),
      status: 'ENROLLED',
      enrolled_at: '2026-01-15',
      exited_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const texts: string[] = [];
    const client = {
      query: vi.fn(async (text: string) => {
        texts.push(text);
        if (text.includes('SELECT * FROM enrollments')) return { rows: [existing] };
        // Simulate the status predicate matching 0 rows.
        if (text.includes('UPDATE enrollments')) return { rows: [] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    const repo = new PgEnrollmentRepository(pool as never);
    await expect(
      repo.updateEnrollment(id, TENANT_ID, { status: 'WITHDRAWN' }, undefined, {
        expectedStatus: 'ENROLLED',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(texts.some((t) => t.includes('FOR UPDATE'))).toBe(true);
    expect(texts.some((t) => /UPDATE enrollments[\s\S]*status = \$11/.test(t))).toBe(true);
  });
});
