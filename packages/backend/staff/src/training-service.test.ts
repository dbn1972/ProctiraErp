/**
 * Unit tests for TrainingService.
 *
 * Tests cover:
 * - Training program CRUD with date validation
 * - Training session creation within program date range
 * - Training attendance recording with duplicate prevention
 * - Certification issuance with expiry date calculation
 * - Certification expiry processing and notification triggering
 *
 * Requirements:
 * - 7.4: Manage training programs, sessions, attendance, and certification tracking
 * - 7.8: Update certification status to expired and trigger notification on expiry
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BusinessRuleError, NotFoundError, ConflictError } from '@proctira/common';

import {
  InMemoryTrainingProgramRepository,
  InMemoryTrainingSessionRepository,
  InMemoryTrainingAttendanceRepository,
  InMemoryCertificationRepository,
} from './in-memory-training-repository.js';
import { TrainingService } from './training-service.js';
import type { NotificationIntegration } from './training-service.js';
import { CertificationStatus } from './training-schemas.js';
import type {
  CreateTrainingProgramInput,
  CreateTrainingSessionInput,
  RecordTrainingAttendanceInput,
  IssueCertificationInput,
} from './training-schemas.js';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const TENANT_ID = uuid();

function validProgramInput(overrides: Partial<CreateTrainingProgramInput> = {}): CreateTrainingProgramInput {
  return {
    name: 'Advanced Teaching Methods',
    description: 'A comprehensive training program',
    startDate: '2024-01-01',
    endDate: '2024-06-30',
    provider: 'Education Institute',
    certificationName: 'Advanced Teaching Certificate',
    certificationValidityDays: 365,
    ...overrides,
  };
}

describe('TrainingService', () => {
  let programRepo: InMemoryTrainingProgramRepository;
  let sessionRepo: InMemoryTrainingSessionRepository;
  let attendanceRepo: InMemoryTrainingAttendanceRepository;
  let certRepo: InMemoryCertificationRepository;
  let service: TrainingService;

  beforeEach(() => {
    programRepo = new InMemoryTrainingProgramRepository();
    sessionRepo = new InMemoryTrainingSessionRepository();
    attendanceRepo = new InMemoryTrainingAttendanceRepository();
    certRepo = new InMemoryCertificationRepository();
    service = new TrainingService(programRepo, sessionRepo, attendanceRepo, certRepo);
  });

  // ─── Training Programs ───────────────────────────────────────────────

  describe('createProgram', () => {
    it('should create a training program with valid dates', async () => {
      const input = validProgramInput();
      const result = await service.createProgram(TENANT_ID, input);

      expect(result.id).toBeDefined();
      expect(result.name).toBe(input.name);
      expect(result.startDate).toBe(input.startDate);
      expect(result.endDate).toBe(input.endDate);
      expect(result.provider).toBe(input.provider);
      expect(result.certificationName).toBe(input.certificationName);
      expect(result.certificationValidityDays).toBe(365);
      expect(result.tenantId).toBe(TENANT_ID);
    });

    it('should throw BusinessRuleError when endDate is before startDate', async () => {
      const input = validProgramInput({ startDate: '2024-06-30', endDate: '2024-01-01' });

      await expect(service.createProgram(TENANT_ID, input)).rejects.toThrow(BusinessRuleError);
      await expect(service.createProgram(TENANT_ID, input)).rejects.toThrow(
        'Program end date (2024-01-01) must be after start date (2024-06-30)',
      );
    });

    it('should throw BusinessRuleError when endDate equals startDate', async () => {
      const input = validProgramInput({ startDate: '2024-01-01', endDate: '2024-01-01' });

      await expect(service.createProgram(TENANT_ID, input)).rejects.toThrow(BusinessRuleError);
    });

    it('should set optional fields to null when not provided', async () => {
      const input: CreateTrainingProgramInput = {
        name: 'Basic Program',
        startDate: '2024-01-01',
        endDate: '2024-03-31',
      };

      const result = await service.createProgram(TENANT_ID, input);
      expect(result.description).toBeNull();
      expect(result.provider).toBeNull();
      expect(result.certificationName).toBeNull();
      expect(result.certificationValidityDays).toBeNull();
    });
  });

  describe('updateProgram', () => {
    it('should update a program', async () => {
      const program = await service.createProgram(TENANT_ID, validProgramInput());

      const updated = await service.updateProgram(TENANT_ID, program.id, {
        name: 'Updated Program Name',
      });

      expect(updated.name).toBe('Updated Program Name');
      expect(updated.startDate).toBe(program.startDate);
    });

    it('should throw NotFoundError when program does not exist', async () => {
      await expect(
        service.updateProgram(TENANT_ID, uuid(), { name: 'New Name' }),
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw BusinessRuleError when update makes endDate <= startDate', async () => {
      const program = await service.createProgram(TENANT_ID, validProgramInput());

      await expect(
        service.updateProgram(TENANT_ID, program.id, { endDate: '2023-12-01' }),
      ).rejects.toThrow(BusinessRuleError);
    });
  });

  // ─── Training Sessions ───────────────────────────────────────────────

  describe('createSession', () => {
    let programId: string;

    beforeEach(async () => {
      const program = await service.createProgram(TENANT_ID, validProgramInput());
      programId = program.id;
    });

    it('should create a session within program date range', async () => {
      const input: CreateTrainingSessionInput = {
        programId,
        title: 'Session 1: Introduction',
        date: '2024-02-15',
        startTime: '09:00',
        endTime: '12:00',
        location: 'Room 101',
        instructorName: 'Dr. Smith',
      };

      const result = await service.createSession(TENANT_ID, input);

      expect(result.id).toBeDefined();
      expect(result.programId).toBe(programId);
      expect(result.title).toBe(input.title);
      expect(result.date).toBe(input.date);
      expect(result.startTime).toBe('09:00');
      expect(result.endTime).toBe('12:00');
      expect(result.location).toBe('Room 101');
      expect(result.instructorName).toBe('Dr. Smith');
    });

    it('should throw NotFoundError when program does not exist', async () => {
      const input: CreateTrainingSessionInput = {
        programId: uuid(),
        title: 'Session 1',
        date: '2024-02-15',
      };

      await expect(service.createSession(TENANT_ID, input)).rejects.toThrow(NotFoundError);
    });

    it('should throw BusinessRuleError when session date is before program start', async () => {
      const input: CreateTrainingSessionInput = {
        programId,
        title: 'Early Session',
        date: '2023-12-01', // Before program start (2024-01-01)
      };

      await expect(service.createSession(TENANT_ID, input)).rejects.toThrow(BusinessRuleError);
      await expect(service.createSession(TENANT_ID, input)).rejects.toThrow(
        'Session date (2023-12-01) must be within program date range',
      );
    });

    it('should throw BusinessRuleError when session date is after program end', async () => {
      const input: CreateTrainingSessionInput = {
        programId,
        title: 'Late Session',
        date: '2024-07-15', // After program end (2024-06-30)
      };

      await expect(service.createSession(TENANT_ID, input)).rejects.toThrow(BusinessRuleError);
    });

    it('should allow session on program start date', async () => {
      const input: CreateTrainingSessionInput = {
        programId,
        title: 'First Day Session',
        date: '2024-01-01',
      };

      const result = await service.createSession(TENANT_ID, input);
      expect(result.date).toBe('2024-01-01');
    });

    it('should allow session on program end date', async () => {
      const input: CreateTrainingSessionInput = {
        programId,
        title: 'Last Day Session',
        date: '2024-06-30',
      };

      const result = await service.createSession(TENANT_ID, input);
      expect(result.date).toBe('2024-06-30');
    });
  });

  // ─── Training Attendance ─────────────────────────────────────────────

  describe('recordAttendance', () => {
    let programId: string;
    let sessionId: string;

    beforeEach(async () => {
      const program = await service.createProgram(TENANT_ID, validProgramInput());
      programId = program.id;
      const session = await service.createSession(TENANT_ID, {
        programId,
        title: 'Session 1',
        date: '2024-02-15',
      });
      sessionId = session.id;
    });

    it('should record attendance for a staff member', async () => {
      const staffId = uuid();
      const input: RecordTrainingAttendanceInput = {
        sessionId,
        staffId,
        status: 'PRESENT',
        comment: 'On time',
      };

      const result = await service.recordAttendance(TENANT_ID, input);

      expect(result.id).toBeDefined();
      expect(result.sessionId).toBe(sessionId);
      expect(result.staffId).toBe(staffId);
      expect(result.status).toBe('PRESENT');
      expect(result.comment).toBe('On time');
    });

    it('should throw NotFoundError when session does not exist', async () => {
      const input: RecordTrainingAttendanceInput = {
        sessionId: uuid(),
        staffId: uuid(),
        status: 'PRESENT',
      };

      await expect(service.recordAttendance(TENANT_ID, input)).rejects.toThrow(NotFoundError);
    });

    it('should throw ConflictError when attendance already recorded for same session+staff', async () => {
      const staffId = uuid();
      const input: RecordTrainingAttendanceInput = {
        sessionId,
        staffId,
        status: 'PRESENT',
      };

      await service.recordAttendance(TENANT_ID, input);

      await expect(service.recordAttendance(TENANT_ID, input)).rejects.toThrow(ConflictError);
      await expect(service.recordAttendance(TENANT_ID, input)).rejects.toThrow(
        'Attendance already recorded',
      );
    });

    it('should allow different staff members at the same session', async () => {
      const staffId1 = uuid();
      const staffId2 = uuid();

      await service.recordAttendance(TENANT_ID, {
        sessionId,
        staffId: staffId1,
        status: 'PRESENT',
      });
      const result = await service.recordAttendance(TENANT_ID, {
        sessionId,
        staffId: staffId2,
        status: 'ABSENT',
      });

      expect(result.staffId).toBe(staffId2);
      expect(result.status).toBe('ABSENT');
    });
  });

  // ─── Certifications ──────────────────────────────────────────────────

  describe('issueCertification', () => {
    let programId: string;

    beforeEach(async () => {
      const program = await service.createProgram(TENANT_ID, validProgramInput());
      programId = program.id;
    });

    it('should issue a certification with explicit expiry date', async () => {
      const input: IssueCertificationInput = {
        staffId: uuid(),
        programId,
        certificationName: 'Advanced Teaching Certificate',
        issuedDate: '2024-06-15',
        expiryDate: '2025-06-15',
      };

      const result = await service.issueCertification(TENANT_ID, input);

      expect(result.id).toBeDefined();
      expect(result.staffId).toBe(input.staffId);
      expect(result.programId).toBe(programId);
      expect(result.certificationName).toBe(input.certificationName);
      expect(result.issuedDate).toBe('2024-06-15');
      expect(result.expiryDate).toBe('2025-06-15');
      expect(result.status).toBe(CertificationStatus.ACTIVE);
    });

    it('should calculate expiry date from program certificationValidityDays', async () => {
      // Program has certificationValidityDays = 365
      const input: IssueCertificationInput = {
        staffId: uuid(),
        programId,
        certificationName: 'Advanced Teaching Certificate',
        issuedDate: '2024-01-01',
        // No explicit expiryDate - should be calculated
      };

      const result = await service.issueCertification(TENANT_ID, input);

      // 2024-01-01 + 365 days = 2024-12-31 (2024 is a leap year)
      expect(result.expiryDate).toBe('2024-12-31');
      expect(result.status).toBe(CertificationStatus.ACTIVE);
    });

    it('should set expiryDate to null when no validity days and no explicit expiry', async () => {
      // Create a program without certificationValidityDays
      const programNoExpiry = await service.createProgram(TENANT_ID, {
        name: 'Lifetime Cert Program',
        startDate: '2024-01-01',
        endDate: '2024-06-30',
      });

      const input: IssueCertificationInput = {
        staffId: uuid(),
        programId: programNoExpiry.id,
        certificationName: 'Lifetime Certificate',
        issuedDate: '2024-06-15',
      };

      const result = await service.issueCertification(TENANT_ID, input);
      expect(result.expiryDate).toBeNull();
    });

    it('should throw NotFoundError when program does not exist', async () => {
      const input: IssueCertificationInput = {
        staffId: uuid(),
        programId: uuid(),
        certificationName: 'Test Cert',
        issuedDate: '2024-06-15',
      };

      await expect(service.issueCertification(TENANT_ID, input)).rejects.toThrow(NotFoundError);
    });

    it('should throw BusinessRuleError when expiryDate is before issuedDate', async () => {
      const input: IssueCertificationInput = {
        staffId: uuid(),
        programId,
        certificationName: 'Test Cert',
        issuedDate: '2024-06-15',
        expiryDate: '2024-01-01', // Before issued date
      };

      await expect(service.issueCertification(TENANT_ID, input)).rejects.toThrow(BusinessRuleError);
      await expect(service.issueCertification(TENANT_ID, input)).rejects.toThrow(
        'Certification expiry date (2024-01-01) must be after issued date (2024-06-15)',
      );
    });
  });

  // ─── Certification Expiry Processing ─────────────────────────────────

  describe('processExpiredCertifications', () => {
    let programId: string;

    beforeEach(async () => {
      const program = await service.createProgram(TENANT_ID, validProgramInput());
      programId = program.id;
    });

    it('should mark expired certifications as EXPIRED', async () => {
      const staffId = uuid();

      // Issue a certification that expires on 2024-06-01
      await service.issueCertification(TENANT_ID, {
        staffId,
        programId,
        certificationName: 'Expiring Cert',
        issuedDate: '2023-06-01',
        expiryDate: '2024-06-01',
      });

      // Process as of 2024-06-02 (after expiry)
      const expired = await service.processExpiredCertifications(TENANT_ID, '2024-06-02');

      expect(expired).toHaveLength(1);
      expect(expired[0]!.status).toBe(CertificationStatus.EXPIRED);
      expect(expired[0]!.staffId).toBe(staffId);
    });

    it('should not mark certifications that have not expired yet', async () => {
      const staffId = uuid();

      await service.issueCertification(TENANT_ID, {
        staffId,
        programId,
        certificationName: 'Future Cert',
        issuedDate: '2024-01-01',
        expiryDate: '2025-01-01',
      });

      // Process as of 2024-06-01 (before expiry)
      const expired = await service.processExpiredCertifications(TENANT_ID, '2024-06-01');

      expect(expired).toHaveLength(0);
    });

    it('should mark certification as expired on exact expiry date', async () => {
      const staffId = uuid();

      await service.issueCertification(TENANT_ID, {
        staffId,
        programId,
        certificationName: 'Today Expiry',
        issuedDate: '2023-06-01',
        expiryDate: '2024-06-01',
      });

      // Process on exact expiry date
      const expired = await service.processExpiredCertifications(TENANT_ID, '2024-06-01');

      expect(expired).toHaveLength(1);
      expect(expired[0]!.status).toBe(CertificationStatus.EXPIRED);
    });

    it('should not process certifications without expiry date', async () => {
      // Create program without validity days
      const noExpiryProgram = await service.createProgram(TENANT_ID, {
        name: 'No Expiry Program',
        startDate: '2024-01-01',
        endDate: '2024-06-30',
      });

      await service.issueCertification(TENANT_ID, {
        staffId: uuid(),
        programId: noExpiryProgram.id,
        certificationName: 'No Expiry Cert',
        issuedDate: '2024-01-01',
      });

      const expired = await service.processExpiredCertifications(TENANT_ID, '2030-01-01');
      expect(expired).toHaveLength(0);
    });

    it('should not re-process already expired certifications', async () => {
      const staffId = uuid();

      await service.issueCertification(TENANT_ID, {
        staffId,
        programId,
        certificationName: 'Already Expired',
        issuedDate: '2023-01-01',
        expiryDate: '2024-01-01',
      });

      // Process once
      const firstRun = await service.processExpiredCertifications(TENANT_ID, '2024-02-01');
      expect(firstRun).toHaveLength(1);

      // Process again - should not find it since it's already EXPIRED
      const secondRun = await service.processExpiredCertifications(TENANT_ID, '2024-03-01');
      expect(secondRun).toHaveLength(0);
    });

    it('should trigger notification on certification expiry (Requirement 7.8)', async () => {
      const mockNotification: NotificationIntegration = {
        sendCertificationExpiryNotification: vi.fn().mockResolvedValue(undefined),
      };

      const serviceWithNotification = new TrainingService(
        programRepo,
        sessionRepo,
        attendanceRepo,
        certRepo,
        mockNotification,
      );

      const staffId = uuid();

      await serviceWithNotification.issueCertification(TENANT_ID, {
        staffId,
        programId,
        certificationName: 'Expiring Cert',
        issuedDate: '2023-06-01',
        expiryDate: '2024-06-01',
      });

      await serviceWithNotification.processExpiredCertifications(TENANT_ID, '2024-06-02');

      expect(mockNotification.sendCertificationExpiryNotification).toHaveBeenCalledWith(
        TENANT_ID,
        staffId,
        'Expiring Cert',
        '2024-06-01',
      );
    });

    it('should process multiple expired certifications', async () => {
      const staffId1 = uuid();
      const staffId2 = uuid();

      await service.issueCertification(TENANT_ID, {
        staffId: staffId1,
        programId,
        certificationName: 'Cert A',
        issuedDate: '2023-01-01',
        expiryDate: '2024-01-01',
      });

      await service.issueCertification(TENANT_ID, {
        staffId: staffId2,
        programId,
        certificationName: 'Cert B',
        issuedDate: '2023-06-01',
        expiryDate: '2024-06-01',
      });

      const expired = await service.processExpiredCertifications(TENANT_ID, '2024-07-01');
      expect(expired).toHaveLength(2);
    });
  });

  // ─── List Operations ─────────────────────────────────────────────────

  describe('listPrograms', () => {
    it('should list programs with pagination', async () => {
      for (let i = 0; i < 3; i++) {
        await service.createProgram(TENANT_ID, validProgramInput({
          name: `Program ${i}`,
          startDate: `2024-0${i + 1}-01`,
          endDate: `2024-0${i + 2}-28`,
        }));
      }

      const result = await service.listPrograms(TENANT_ID, undefined, { page: 1, pageSize: 20 });
      expect(result.data).toHaveLength(3);
      expect(result.meta.totalItems).toBe(3);
    });

    it('should search programs by name', async () => {
      await service.createProgram(TENANT_ID, validProgramInput({ name: 'Advanced Teaching' }));
      await service.createProgram(TENANT_ID, validProgramInput({
        name: 'Basic Admin',
        startDate: '2024-07-01',
        endDate: '2024-12-31',
      }));

      const result = await service.listPrograms(TENANT_ID, 'advanced', { page: 1, pageSize: 20 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.name).toBe('Advanced Teaching');
    });
  });

  describe('listCertifications', () => {
    let programId: string;

    beforeEach(async () => {
      const program = await service.createProgram(TENANT_ID, validProgramInput());
      programId = program.id;
    });

    it('should filter certifications by staffId', async () => {
      const staffId1 = uuid();
      const staffId2 = uuid();

      await service.issueCertification(TENANT_ID, {
        staffId: staffId1,
        programId,
        certificationName: 'Cert 1',
        issuedDate: '2024-01-01',
        expiryDate: '2025-01-01',
      });
      await service.issueCertification(TENANT_ID, {
        staffId: staffId2,
        programId,
        certificationName: 'Cert 2',
        issuedDate: '2024-01-01',
        expiryDate: '2025-01-01',
      });

      const result = await service.listCertifications(
        TENANT_ID,
        { staffId: staffId1 },
        { page: 1, pageSize: 20 },
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.staffId).toBe(staffId1);
    });

    it('should filter certifications by status', async () => {
      const staffId = uuid();

      await service.issueCertification(TENANT_ID, {
        staffId,
        programId,
        certificationName: 'Active Cert',
        issuedDate: '2024-01-01',
        expiryDate: '2025-01-01',
      });
      await service.issueCertification(TENANT_ID, {
        staffId,
        programId,
        certificationName: 'Expiring Cert',
        issuedDate: '2023-01-01',
        expiryDate: '2024-01-01',
      });

      // Process expiry
      await service.processExpiredCertifications(TENANT_ID, '2024-02-01');

      const activeResult = await service.listCertifications(
        TENANT_ID,
        { status: 'ACTIVE' },
        { page: 1, pageSize: 20 },
      );
      expect(activeResult.data).toHaveLength(1);
      expect(activeResult.data[0]!.certificationName).toBe('Active Cert');

      const expiredResult = await service.listCertifications(
        TENANT_ID,
        { status: 'EXPIRED' },
        { page: 1, pageSize: 20 },
      );
      expect(expiredResult.data).toHaveLength(1);
      expect(expiredResult.data[0]!.certificationName).toBe('Expiring Cert');
    });
  });
});
