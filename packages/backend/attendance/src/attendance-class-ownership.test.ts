/**
 * PRC-M172: teacher-to-class ownership scoping on attendance writes.
 *
 * A teacher may only write attendance for classes/sections they are assigned to
 * (`staff_assignments`, linked via `staff.user_id`). An unassigned-class write
 * must be rejected with 403/FORBIDDEN. Institution-wide roles (admin, principal,
 * registrar, attendance_officer, ...) bypass the ownership check.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AppError } from '@proctira/common';

import { AttendanceService } from './attendance-service.js';
import { InMemoryAttendanceRepository } from './in-memory-repository.js';
import type {
  AcademicPeriodInfo,
  AttendanceClassMembershipCheck,
} from './attendance-repository.js';

const TENANT_ID = 'tenant-001';
const INSTITUTION_ID = '11111111-1111-4111-8111-111111111111';
const PERIOD_ID = '55555555-5555-4555-8555-555555555555';

const CLASS_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // teacher-a assigned here
const CLASS_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // teacher-a NOT assigned here

const TEACHER_A_SUB = 'teacher-a-sub-id';
const TEACHER_A_STAFF_ID = 'staff-a';

const STUDENT_A = '33333333-3333-4333-8333-333333333333';
const STUDENT_B = '44444444-4444-4444-8444-444444444444';

function createActivePeriod(): AcademicPeriodInfo {
  return {
    id: PERIOD_ID,
    tenantId: TENANT_ID,
    name: 'Academic Year 2024',
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-12-31'),
    status: 'active',
  };
}

/**
 * PRC-M172 (Charter §32 relocation): a local stand-in for the injected
 * `AttendanceClassMembershipCheck`, closed over hand-seeded assignment rows. Production wires
 * this callback to `@proctira/backend-staff`'s `listActiveStaffIdsForClass`; the test double
 * here keeps the same `(tenantId, classId, principalIds) => staffIds[]` contract without
 * depending on the staff package.
 */
function fakeClassMembership(
  assignments: ReadonlyArray<{
    tenantId: string;
    classId: string;
    principalId: string;
    staffId: string;
  }>,
): AttendanceClassMembershipCheck {
  return async (tenantId, classId, principalIds) => {
    const wanted = new Set(principalIds);
    return [
      ...new Set(
        assignments
          .filter(
            (a) => a.tenantId === tenantId && a.classId === classId && wanted.has(a.principalId),
          )
          .map((a) => a.staffId),
      ),
    ];
  };
}

describe('PRC-M172 teacher-to-class ownership scoping', () => {
  let repository: InMemoryAttendanceRepository;
  let classMembership: AttendanceClassMembershipCheck;

  beforeEach(() => {
    repository = new InMemoryAttendanceRepository();
    repository.addAcademicPeriod(createActivePeriod());
    classMembership = fakeClassMembership([
      {
        tenantId: TENANT_ID,
        classId: CLASS_A,
        principalId: TEACHER_A_SUB,
        staffId: TEACHER_A_STAFF_ID,
      },
    ]);
  });

  it('VULNERABLE BASELINE: without class-membership wiring, a teacher can write attendance for a class they are not assigned to', async () => {
    // This is the pre-fix shape: AttendanceService constructed with no actor-aware
    // options, and recordStudentAttendance called without an actor at all — the
    // legacy, fully-unscoped call path. It documents the hole PRC-M172 closes;
    // internal/system callers that never pass an actor keep this (intentional)
    // unscoped behaviour after the fix too.
    const service = new AttendanceService(repository);
    const record = await service.recordStudentAttendance(
      TENANT_ID,
      {
        studentId: STUDENT_B,
        institutionId: INSTITUTION_ID,
        classId: CLASS_B,
        academicPeriodId: PERIOD_ID,
        date: '2024-06-01',
        status: 'PRESENT',
      } as never,
      TEACHER_A_SUB,
    );
    expect(record.classId).toBe(CLASS_B);
  });

  it('rejects a teacher writing attendance for a class they are NOT assigned to (403 FORBIDDEN)', async () => {
    const service = new AttendanceService(repository, undefined, {
      classMembership,
    });

    await expect(
      service.recordStudentAttendance(
        TENANT_ID,
        {
          studentId: STUDENT_B,
          institutionId: INSTITUTION_ID,
          classId: CLASS_B,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-01',
          status: 'PRESENT',
        } as never,
        TEACHER_A_SUB,
        { id: TEACHER_A_SUB, roles: ['teacher'] },
      ),
    ).rejects.toMatchObject(
      expect.objectContaining({
        statusCode: 403,
        code: 'FORBIDDEN',
      }) as Partial<AppError>,
    );
  });

  it('allows a teacher to write attendance for a class they ARE assigned to', async () => {
    const service = new AttendanceService(repository, undefined, {
      classMembership,
    });

    const record = await service.recordStudentAttendance(
      TENANT_ID,
      {
        studentId: STUDENT_A,
        institutionId: INSTITUTION_ID,
        classId: CLASS_A,
        academicPeriodId: PERIOD_ID,
        date: '2024-06-01',
        status: 'PRESENT',
      } as never,
      TEACHER_A_SUB,
      { id: TEACHER_A_SUB, roles: ['teacher'] },
    );
    expect(record.classId).toBe(CLASS_A);
  });

  it('allows an institution-wide role (admin) to write attendance for any class without an assignment', async () => {
    const service = new AttendanceService(repository, undefined, {
      classMembership,
    });

    const record = await service.recordStudentAttendance(
      TENANT_ID,
      {
        studentId: STUDENT_B,
        institutionId: INSTITUTION_ID,
        classId: CLASS_B,
        academicPeriodId: PERIOD_ID,
        date: '2024-06-01',
        status: 'PRESENT',
      } as never,
      'admin-sub-id',
      { id: 'admin-sub-id', roles: ['admin'] },
    );
    expect(record.classId).toBe(CLASS_B);
  });
});
