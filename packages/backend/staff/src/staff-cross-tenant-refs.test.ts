/**
 * PRC-M374: HR sub-records cannot reference another tenant's staff id (404),
 * and the check runs before any lookup/insert.
 */
import { NotFoundError } from '@proctira/common';
import { describe, expect, it } from 'vitest';
import { AppraisalService } from './appraisal-service.js';
import { StaffAssignmentService } from './assignment-service.js';
import {
  InMemoryAppraisalRepository,
  InMemoryAppraisalTemplateRepository,
} from './in-memory-appraisal-repository.js';
import { InMemoryAssignmentRepository } from './in-memory-assignment-repository.js';
import { InMemoryStaffLeaveRepository } from './in-memory-leave-repository.js';
import { InMemoryStaffRepository } from './in-memory-repository.js';
import {
  InMemoryCertificationRepository,
  InMemoryTrainingAttendanceRepository,
  InMemoryTrainingProgramRepository,
  InMemoryTrainingSessionRepository,
} from './in-memory-training-repository.js';
import { StaffLeaveService } from './leave-service.js';
import { StaffService } from './staff-service.js';
import { TrainingService } from './training-service.js';

const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';
const TENANT_B = '660e8400-e29b-41d4-a716-446655440001';
const ID = '770e8400-e29b-41d4-a716-446655440002';

async function setup() {
  const repo = new InMemoryStaffRepository();
  const staff = await new StaffService(repo).create(TENANT_B, {
    firstName: 'B',
    lastName: 'Staff',
    dateOfBirth: '1980-01-01',
    identityNumber: `ID-${Math.random()}`,
    contactPhone: '+100000000',
    position: 'Teacher',
  });
  const staffExists = async (tenantId: string, staffId: string) =>
    (await repo.findById(staffId, tenantId)) !== null;
  return { staffIdOfB: staff.id, staffExists };
}

describe('cross-tenant staff references (PRC-M374)', () => {
  it('tenant A cannot create leave/assignment/appraisal/attendance/cert for tenant B staff', async () => {
    const { staffIdOfB, staffExists } = await setup();
    const leave = new StaffLeaveService(new InMemoryStaffLeaveRepository(), staffExists);
    await expect(
      leave.createLeave(TENANT_A, {
        staffId: staffIdOfB,
        leaveType: 'unpaid',
        startDate: '2026-09-10',
        endDate: '2026-09-10',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Same id in its own tenant passes the reference check.
    await expect(
      leave.createLeave(TENANT_B, {
        staffId: staffIdOfB,
        leaveType: 'unpaid',
        startDate: '2026-09-10',
        endDate: '2026-09-10',
      }),
    ).resolves.toMatchObject({ staffId: staffIdOfB });

    const assignments = new StaffAssignmentService(new InMemoryAssignmentRepository(), staffExists);
    await expect(
      assignments.create(TENANT_A, {
        staffId: staffIdOfB,
        institutionId: ID,
        subjectId: ID,
        classId: ID,
        role: 'Teacher',
        startDate: '2026-01-01',
        allocationPercentage: 50,
      } as never),
    ).rejects.toBeInstanceOf(NotFoundError);

    const appraisals = new AppraisalService(
      new InMemoryAppraisalTemplateRepository(),
      new InMemoryAppraisalRepository(),
      undefined,
      staffExists,
    );
    await expect(
      appraisals.createAppraisal(TENANT_A, {
        staffId: staffIdOfB,
        templateId: ID,
        appraisalDate: '2026-01-01',
        scores: [{ criterionName: 'x', score: 1 }],
      } as never),
    ).rejects.toThrow(/Staff with id/);

    const training = new TrainingService(
      new InMemoryTrainingProgramRepository(),
      new InMemoryTrainingSessionRepository(),
      new InMemoryTrainingAttendanceRepository(),
      new InMemoryCertificationRepository(),
      undefined,
      staffExists,
    );
    await expect(
      training.recordAttendance(TENANT_A, {
        sessionId: ID,
        staffId: staffIdOfB,
        status: 'PRESENT',
      }),
    ).rejects.toThrow(/Staff with id/);
    await expect(
      training.issueCertification(TENANT_A, {
        staffId: staffIdOfB,
        programId: ID,
        certificationName: 'First aid',
        issuedDate: '2026-01-01',
      } as never),
    ).rejects.toThrow(/Staff with id/);
  });
});
