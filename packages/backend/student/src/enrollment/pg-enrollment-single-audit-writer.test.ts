/**
 * W1-DATA-14 — PgEnrollmentRepository is the single audit writer on Postgres:
 * sets enrollment_history GUCs then mutates; createHistoryEntry does not INSERT.
 */
import { describe, expect, it, vi } from 'vitest';

import { EnrollmentService } from './enrollment-service.js';
import { PgEnrollmentRepository } from './pg-enrollment-repository.js';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

describe('W1-DATA-14 PgEnrollmentRepository single history writer', () => {
  it('advertises writesHistoryViaDatabase', () => {
    const repo = new PgEnrollmentRepository({ query: vi.fn() } as never);
    expect(repo.writesHistoryViaDatabase).toBe(true);
  });

  it('createEnrollment sets history GUCs and never INSERTs enrollment_history', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const enrollmentId = uuid();
    const tenantId = uuid();
    const row = {
      id: enrollmentId,
      tenant_id: tenantId,
      student_id: uuid(),
      institution_id: uuid(),
      grade_id: uuid(),
      class_id: uuid(),
      academic_period_id: uuid(),
      status: 'ENROLLED',
      enrolled_at: new Date('2026-01-15'),
      exited_at: null,
      created_at: new Date('2026-01-15'),
      updated_at: new Date('2026-01-15'),
    };

    const client = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
        if (text.includes('set_config')) return { rows: [] };
        if (text.includes('INSERT INTO enrollments')) return { rows: [row] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    const repo = new PgEnrollmentRepository(pool as never);

    await repo.createEnrollment(
      {
        id: enrollmentId,
        tenantId,
        studentId: String(row.student_id),
        institutionId: String(row.institution_id),
        gradeId: String(row.grade_id),
        classId: String(row.class_id),
        academicPeriodId: String(row.academic_period_id),
        status: 'ENROLLED',
        enrolledAt: new Date('2026-01-15'),
        exitedAt: null,
      },
      { reason: 'Initial enrollment', effectiveDate: new Date('2026-01-15') },
    );

    const texts = queries.map((q) => q.text);
    expect(texts.some((t) => t.includes("set_config('app.enrollment_history_reason'"))).toBe(true);
    expect(
      texts.some((t) => t.includes("set_config('app.enrollment_history_effective_date'")),
    ).toBe(true);
    expect(texts.some((t) => t.includes('INSERT INTO enrollments'))).toBe(true);
    expect(texts.some((t) => t.includes('INSERT INTO enrollment_history'))).toBe(false);

    const reasonCall = queries.find((q) =>
      q.text.includes("set_config('app.enrollment_history_reason'"),
    );
    expect(reasonCall?.values?.[0]).toBe('Initial enrollment');
  });

  it('createHistoryEntry is a no-op (no enrollment_history INSERT)', async () => {
    const client = {
      query: vi.fn(async (text: string) => {
        if (text === 'BEGIN' || text === 'COMMIT' || text.includes('set_config')) {
          return { rows: [] };
        }
        throw new Error(`unexpected query: ${text}`);
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    const repo = new PgEnrollmentRepository(pool as never);

    const entry = await repo.createHistoryEntry({
      id: uuid(),
      tenantId: uuid(),
      enrollmentId: uuid(),
      previousStatus: null,
      newStatus: 'ENROLLED',
      effectiveDate: new Date('2026-01-15'),
      institutionId: uuid(),
      academicPeriodId: uuid(),
      reason: 'should not insert',
    });

    expect(entry.reason).toBe('should not insert');
    expect(client.query).not.toHaveBeenCalled();
  });

  it('EnrollmentService skips createHistoryEntry when repository writes via DB', async () => {
    const tenantId = uuid();
    const institutionId = uuid();
    const createHistoryEntry = vi.fn();
    const createEnrollment = vi.fn(async (data: { id: string }) => ({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    const findInstitutionById = vi.fn(async () => ({ id: institutionId, status: 'active' }));
    const findActiveEnrollment = vi.fn(async () => null);

    const repo = {
      writesHistoryViaDatabase: true as const,
      createEnrollment,
      createHistoryEntry,
      findInstitutionById,
      findActiveEnrollment,
      updateEnrollment: vi.fn(),
      findEnrollmentById: vi.fn(),
      listEnrollments: vi.fn(),
      getEnrollmentHistory: vi.fn(),
      getHistoryByEnrollmentId: vi.fn(),
      createTransferRecord: vi.fn(),
      getTransferRecords: vi.fn(),
    };

    const service = new EnrollmentService(repo as never);
    await service.createEnrollment(tenantId, {
      studentId: uuid(),
      institutionId,
      gradeId: uuid(),
      classId: uuid(),
      academicPeriodId: uuid(),
      enrolledAt: '2026-01-15',
    });

    expect(createEnrollment).toHaveBeenCalledTimes(1);
    expect(createEnrollment.mock.calls[0]?.[1]).toEqual({
      reason: 'Initial enrollment',
      effectiveDate: new Date('2026-01-15'),
    });
    expect(createHistoryEntry).not.toHaveBeenCalled();
  });

  it('updateEnrollment sets GUCs before status UPDATE (no history INSERT)', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const enrollmentId = uuid();
    const tenantId = uuid();
    const existing = {
      id: enrollmentId,
      tenant_id: tenantId,
      student_id: uuid(),
      institution_id: uuid(),
      grade_id: uuid(),
      class_id: uuid(),
      academic_period_id: uuid(),
      status: 'ENROLLED',
      enrolled_at: new Date('2026-01-15'),
      exited_at: null,
      created_at: new Date('2026-01-15'),
      updated_at: new Date('2026-01-15'),
    };
    const updated = { ...existing, status: 'WITHDRAWN', exited_at: new Date('2026-06-01') };

    const client = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
        if (text.includes('set_config')) return { rows: [] };
        if (text.includes('SELECT * FROM enrollments')) return { rows: [existing] };
        if (text.includes('UPDATE enrollments')) return { rows: [updated] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    const repo = new PgEnrollmentRepository(pool as never);

    await repo.updateEnrollment(
      enrollmentId,
      tenantId,
      { status: 'WITHDRAWN', exitedAt: new Date('2026-06-01') },
      { reason: 'Family relocated', effectiveDate: new Date('2026-06-01') },
    );

    const texts = queries.map((q) => q.text);
    const reasonIdx = texts.findIndex((t) =>
      t.includes("set_config('app.enrollment_history_reason'"),
    );
    const updateIdx = texts.findIndex((t) => t.includes('UPDATE enrollments'));
    expect(reasonIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThan(reasonIdx);
    expect(texts.some((t) => t.includes('INSERT INTO enrollment_history'))).toBe(false);
  });
});
