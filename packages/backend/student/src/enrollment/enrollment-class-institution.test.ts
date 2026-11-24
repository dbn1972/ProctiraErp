/**
 * M1-I4: POST /enrollments must refuse a class that belongs to another
 * institution of the same tenant; nothing is written.
 */
import { randomUUID } from 'node:crypto';

import { BusinessRuleError } from '@proctira/common';
import { describe, expect, it, vi } from 'vitest';

import { CLASS_OUTSIDE_INSTITUTION } from './enrollment-repository.js';
import { EnrollmentService } from './enrollment-service.js';
import { InMemoryEnrollmentRepository } from './in-memory-enrollment-repository.js';
import { PgEnrollmentRepository } from './pg-enrollment-repository.js';

const TENANT = randomUUID();
const SCHOOL_A = randomUUID();
const SCHOOL_B = randomUUID();
const CLASS_A = randomUUID();
const CLASS_B = randomUUID();

function input(classId: string) {
  return {
    studentId: randomUUID(),
    institutionId: SCHOOL_A,
    gradeId: randomUUID(),
    classId,
    academicPeriodId: randomUUID(),
    enrolledAt: '2026-01-15',
  };
}

describe('enrollment class belongs to the institution (M1-I4)', () => {
  function service() {
    const repository = new InMemoryEnrollmentRepository();
    repository.addInstitution(SCHOOL_A, TENANT, 'active');
    repository.addInstitution(SCHOOL_B, TENANT, 'active');
    repository.addClass(CLASS_A, TENANT, SCHOOL_A);
    repository.addClass(CLASS_B, TENANT, SCHOOL_B);
    return { repository, service: new EnrollmentService(repository) };
  }

  it('refuses a class of another institution and stores nothing', async () => {
    const { service: svc } = service();
    const body = input(CLASS_B);
    const attempt = svc.createEnrollment(TENANT, body);
    await expect(attempt).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(attempt).rejects.toMatchObject({ statusCode: 422 });
    const page = await svc.listEnrollments(
      TENANT,
      { studentId: body.studentId },
      { page: 1, pageSize: 10 },
    );
    expect(page.data).toEqual([]);
  });

  it('accepts a class of the same institution', async () => {
    const { service: svc } = service();
    const created = await svc.createEnrollment(TENANT, input(CLASS_A));
    expect(created.classId).toBe(CLASS_A);
    expect(created.institutionId).toBe(SCHOOL_A);
  });

  function pgRepo(classInstitutionId: string | null) {
    const texts: string[] = [];
    const client = {
      query: vi.fn(async (text: string) => {
        texts.push(text);
        if (text.includes('FROM classes')) {
          return { rows: classInstitutionId ? [{ institution_id: classInstitutionId }] : [] };
        }
        if (text.includes('INSERT INTO enrollments')) {
          return {
            rows: [
              {
                id: randomUUID(),
                tenant_id: TENANT,
                student_id: randomUUID(),
                institution_id: SCHOOL_A,
                grade_id: randomUUID(),
                class_id: CLASS_A,
                academic_period_id: randomUUID(),
                status: 'ENROLLED',
                enrolled_at: new Date('2026-01-15'),
                exited_at: null,
                created_at: new Date('2026-01-15'),
                updated_at: new Date('2026-01-15'),
              },
            ],
          };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    return { repo: new PgEnrollmentRepository(pool as never), texts };
  }

  function entity(classId: string) {
    return {
      id: randomUUID(),
      tenantId: TENANT,
      studentId: randomUUID(),
      institutionId: SCHOOL_A,
      gradeId: randomUUID(),
      classId,
      academicPeriodId: randomUUID(),
      status: 'ENROLLED' as const,
      enrolledAt: new Date('2026-01-15'),
      exitedAt: null,
    };
  }

  it('Postgres: a class of another institution is refused before the insert', async () => {
    const { repo, texts } = pgRepo(SCHOOL_B);
    await expect(repo.createEnrollment(entity(CLASS_B))).rejects.toThrow(CLASS_OUTSIDE_INSTITUTION);
    expect(texts.some((t) => t.includes('INSERT INTO enrollments'))).toBe(false);
    expect(texts).toContain('ROLLBACK');
  });

  it('Postgres: a class of the same institution is inserted', async () => {
    const { repo, texts } = pgRepo(SCHOOL_A);
    const row = await repo.createEnrollment(entity(CLASS_A));
    expect(row.classId).toBe(CLASS_A);
    expect(texts.some((t) => t.includes('INSERT INTO enrollments'))).toBe(true);
  });
});
