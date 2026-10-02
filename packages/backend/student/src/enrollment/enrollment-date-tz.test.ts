/**
 * PRC-L161: DATE columns round-trip unchanged under a positive UTC offset.
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { PgEnrollmentRepository, toDateOnly } from './pg-enrollment-repository.js';
import { EnrollmentParamsSchema } from './schemas.js';

describe('enrollment DATE handling under TZ=Asia/Kolkata', () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Asia/Kolkata';
  });
  afterAll(() => {
    process.env.TZ = originalTz;
  });

  it('normalises pg local-midnight DATE values to the stored calendar day', () => {
    // node-pg builds DATE as new Date(y, m, d) — local midnight.
    const pgValue = new Date(2024, 0, 15);
    expect(pgValue.toISOString().slice(0, 10)).toBe('2024-01-14'); // the bug
    expect(toDateOnly(pgValue).toISOString().slice(0, 10)).toBe('2024-01-15');
    expect(toDateOnly('2024-01-15').toISOString().slice(0, 10)).toBe('2024-01-15');
  });

  it('createEnrollment writes YYYY-MM-DD and returns enrolledAt unchanged', async () => {
    const tenantId = randomUUID();
    let params: unknown[] = [];
    const client = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        if (text.includes('INSERT INTO enrollments')) {
          params = values ?? [];
          return {
            rows: [
              {
                id: values![0],
                tenant_id: tenantId,
                student_id: values![2],
                institution_id: values![3],
                grade_id: values![4],
                class_id: values![5],
                academic_period_id: values![6],
                status: 'ENROLLED',
                // Simulate node-pg DATE parsing of the stored value.
                enrolled_at: new Date(2024, 0, 15),
                exited_at: null,
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    const repo = new PgEnrollmentRepository(pool as never);
    const created = await repo.createEnrollment({
      id: randomUUID(),
      tenantId,
      studentId: randomUUID(),
      institutionId: randomUUID(),
      gradeId: randomUUID(),
      classId: randomUUID(),
      academicPeriodId: randomUUID(),
      status: 'ENROLLED',
      enrolledAt: new Date('2024-01-15'),
      exitedAt: null,
    });
    expect(params[8]).toBe('2024-01-15');
    expect(params[9]).toBeNull();
    expect(created.enrolledAt.toISOString().split('T')[0]).toBe('2024-01-15');
  });
});

describe('shared UUID pattern', () => {
  it('accepts v7 ids, not only v4', () => {
    expect(
      Value.Check(EnrollmentParamsSchema, { id: '01890a5d-ac96-774b-bcce-b302099a8057' }),
    ).toBe(true);
    expect(Value.Check(EnrollmentParamsSchema, { id: 'not-a-uuid' })).toBe(false);
  });
});
