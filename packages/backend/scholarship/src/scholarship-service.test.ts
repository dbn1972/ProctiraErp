/**
 * Scholarship Service Unit Tests
 *
 * Tests business logic for scholarship program management, application processing,
 * disbursement tracking, compliance monitoring, and utilization reporting.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictError, NotFoundError, BusinessRuleError, ValidationError } from '@proctira/common';

import { ScholarshipService } from './scholarship-service.js';
import type { WorkflowEngineClient } from './scholarship-service.js';
import { InMemoryScholarshipRepository } from './in-memory-repository.js';
import type { CreateScholarshipProgramInput, CreateApplicationInput } from './schemas.js';

const TENANT_ID = 'tenant-001';

function makeUuid(): string {
  return 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
}

function makeProgramInput(
  overrides: Partial<CreateScholarshipProgramInput> = {},
): CreateScholarshipProgramInput {
  return {
    name: 'Merit Scholarship 2024',
    applicationStartDate: '2024-01-01',
    applicationEndDate: '2024-06-30',
    totalSlots: 50,
    amountPerRecipient: 5000,
    eligibility: {
      minGPA: 3.0,
      requiredDocuments: ['transcript', 'recommendation_letter'],
    },
    ...overrides,
  };
}

function makeApplicationInput(
  programId: string,
  overrides: Partial<CreateApplicationInput> = {},
): CreateApplicationInput {
  return {
    programId,
    applicantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    institutionId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
    academicRecords: [
      {
        institutionName: 'Test University',
        educationLevel: 'undergraduate',
        gpa: 3.5,
        yearCompleted: 2023,
      },
    ],
    financialInfo: {
      familyIncome: 30000,
      numberOfDependents: 3,
    },
    documents: [
      {
        documentType: 'transcript',
        fileName: 'transcript.pdf',
        fileUrl: '/uploads/transcript.pdf',
      },
      { documentType: 'recommendation_letter', fileName: 'rec.pdf', fileUrl: '/uploads/rec.pdf' },
    ],
    gender: 'female',
    areaId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
    ...overrides,
  };
}

describe('ScholarshipService', () => {
  let repository: InMemoryScholarshipRepository;
  let service: ScholarshipService;
  let mockWorkflowEngine: WorkflowEngineClient;

  beforeEach(() => {
    repository = new InMemoryScholarshipRepository();
    mockWorkflowEngine = {
      createInstance: async () => 'workflow-instance-001',
    };
    service = new ScholarshipService(repository, mockWorkflowEngine);
  });

  // ─── Program Tests ───────────────────────────────────────────────────────

  describe('createProgram', () => {
    it('should create a scholarship program with valid input', async () => {
      const input = makeProgramInput();
      const program = await service.createProgram(TENANT_ID, input);

      expect(program.id).toBeDefined();
      expect(program.tenantId).toBe(TENANT_ID);
      expect(program.name).toBe(input.name);
      expect(program.totalSlots).toBe(50);
      expect(program.usedSlots).toBe(0);
      expect(program.amountPerRecipient).toBe(5000);
      expect(program.status).toBe('draft');
      expect(program.eligibility.minGPA).toBe(3.0);
      expect(program.currency).toBe('USD');
      expect(program.disbursementFrequency).toBe('one_time');
    });

    it('should throw ValidationError if start date is after end date', async () => {
      const input = makeProgramInput({
        applicationStartDate: '2024-07-01',
        applicationEndDate: '2024-01-01',
      });

      await expect(service.createProgram(TENANT_ID, input)).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError if start date equals end date', async () => {
      const input = makeProgramInput({
        applicationStartDate: '2024-06-01',
        applicationEndDate: '2024-06-01',
      });

      await expect(service.createProgram(TENANT_ID, input)).rejects.toThrow(ValidationError);
    });
  });

  describe('updateProgram', () => {
    it('should update a program with valid input', async () => {
      const program = await service.createProgram(TENANT_ID, makeProgramInput());
      const updated = await service.updateProgram(TENANT_ID, program.id, { name: 'Updated Name' });

      expect(updated.name).toBe('Updated Name');
    });

    it('should throw NotFoundError for non-existent program', async () => {
      await expect(service.updateProgram(TENANT_ID, makeUuid(), { name: 'Test' })).rejects.toThrow(
        NotFoundError,
      );
    });

    it('should throw BusinessRuleError for archived program', async () => {
      const program = await service.createProgram(TENANT_ID, makeProgramInput());
      await service.updateProgram(TENANT_ID, program.id, { status: 'archived' });

      await expect(service.updateProgram(TENANT_ID, program.id, { name: 'Test' })).rejects.toThrow(
        BusinessRuleError,
      );
    });
  });

  describe('deleteProgram', () => {
    it('should delete a program with no applications', async () => {
      const program = await service.createProgram(TENANT_ID, makeProgramInput());
      await service.deleteProgram(TENANT_ID, program.id);

      await expect(service.getProgramById(TENANT_ID, program.id)).rejects.toThrow(NotFoundError);
    });

    it('should throw BusinessRuleError if program has applications', async () => {
      const program = await service.createProgram(TENANT_ID, makeProgramInput());
      // Open the program and submit an application
      await service.updateProgram(TENANT_ID, program.id, { status: 'open' });

      // Manually create an application in the repository
      const appInput = makeApplicationInput(program.id);
      await repository.createApplication({
        id: 'app-001',
        tenantId: TENANT_ID,
        programId: program.id,
        applicantId: appInput.applicantId,
        institutionId: appInput.institutionId,
        status: 'submitted',
        academicRecords: appInput.academicRecords,
        financialInfo: appInput.financialInfo,
        documents: appInput.documents,
        personalStatement: null,
        areaId: null,
        gender: null,
        workflowInstanceId: null,
        submittedAt: new Date(),
        reviewedAt: null,
      });

      await expect(service.deleteProgram(TENANT_ID, program.id)).rejects.toThrow(BusinessRuleError);
    });
  });

  // ─── Application Tests ───────────────────────────────────────────────────

  describe('submitApplication', () => {
    it('should submit an application for an open program', async () => {
      const program = await service.createProgram(TENANT_ID, makeProgramInput());
      await service.updateProgram(TENANT_ID, program.id, { status: 'open' });

      // Mock today's date to be within application period
      const originalDate = Date;
      const mockDate = new Date('2024-03-15');
      vi.useFakeTimers();
      vi.setSystemTime(mockDate);

      try {
        const application = await service.submitApplication(
          TENANT_ID,
          makeApplicationInput(program.id),
        );

        expect(application.id).toBeDefined();
        expect(application.programId).toBe(program.id);
        expect(application.status).toBe('under_review'); // Workflow engine sets this
        expect(application.workflowInstanceId).toBe('workflow-instance-001');
      } finally {
        vi.useRealTimers();
      }
    });

    it('should throw BusinessRuleError if program is not open', async () => {
      const program = await service.createProgram(TENANT_ID, makeProgramInput());
      // Program is in 'draft' status

      await expect(
        service.submitApplication(TENANT_ID, makeApplicationInput(program.id)),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should throw BusinessRuleError if application period is not active', async () => {
      const program = await service.createProgram(
        TENANT_ID,
        makeProgramInput({
          applicationStartDate: '2025-01-01',
          applicationEndDate: '2025-06-30',
        }),
      );
      await service.updateProgram(TENANT_ID, program.id, { status: 'open' });

      // Current date is before application period
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-01'));

      try {
        await expect(
          service.submitApplication(TENANT_ID, makeApplicationInput(program.id)),
        ).rejects.toThrow(BusinessRuleError);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should throw BusinessRuleError if no slots available', async () => {
      const program = await service.createProgram(TENANT_ID, makeProgramInput({ totalSlots: 1 }));
      await service.updateProgram(TENANT_ID, program.id, { status: 'open' });

      // Directly set usedSlots on the repository to simulate full capacity
      await repository.updateProgram(program.id, TENANT_ID, { usedSlots: 1 });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-15'));

      try {
        await expect(
          service.submitApplication(TENANT_ID, makeApplicationInput(program.id)),
        ).rejects.toThrow(BusinessRuleError);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should throw ConflictError if applicant already applied', async () => {
      const program = await service.createProgram(TENANT_ID, makeProgramInput());
      await service.updateProgram(TENANT_ID, program.id, { status: 'open' });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-15'));

      try {
        await service.submitApplication(TENANT_ID, makeApplicationInput(program.id));
        await expect(
          service.submitApplication(TENANT_ID, makeApplicationInput(program.id)),
        ).rejects.toThrow(ConflictError);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should throw ValidationError if required documents are missing', async () => {
      const program = await service.createProgram(TENANT_ID, makeProgramInput());
      await service.updateProgram(TENANT_ID, program.id, { status: 'open' });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-15'));

      try {
        const input = makeApplicationInput(program.id, {
          documents: [
            {
              documentType: 'transcript',
              fileName: 'transcript.pdf',
              fileUrl: '/uploads/transcript.pdf',
            },
            // Missing 'recommendation_letter'
          ],
        });

        await expect(service.submitApplication(TENANT_ID, input)).rejects.toThrow(ValidationError);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('approveApplication', () => {
    it('should approve a submitted application', async () => {
      const program = await service.createProgram(TENANT_ID, makeProgramInput());
      await service.updateProgram(TENANT_ID, program.id, { status: 'open' });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-15'));

      try {
        const application = await service.submitApplication(
          TENANT_ID,
          makeApplicationInput(program.id),
        );
        const approved = await service.approveApplication(TENANT_ID, application.id);

        expect(approved.status).toBe('approved');
        expect(approved.reviewedAt).toBeDefined();

        // Check that used slots incremented
        const updatedProgram = await service.getProgramById(TENANT_ID, program.id);
        expect(updatedProgram.usedSlots).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should throw BusinessRuleError if application is already approved', async () => {
      const program = await service.createProgram(TENANT_ID, makeProgramInput());
      await service.updateProgram(TENANT_ID, program.id, { status: 'open' });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-15'));

      try {
        const application = await service.submitApplication(
          TENANT_ID,
          makeApplicationInput(program.id),
        );
        await service.approveApplication(TENANT_ID, application.id);

        await expect(service.approveApplication(TENANT_ID, application.id)).rejects.toThrow(
          BusinessRuleError,
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('rejectApplication', () => {
    it('should reject a submitted application', async () => {
      const program = await service.createProgram(TENANT_ID, makeProgramInput());
      await service.updateProgram(TENANT_ID, program.id, { status: 'open' });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-15'));

      try {
        const application = await service.submitApplication(
          TENANT_ID,
          makeApplicationInput(program.id),
        );
        const rejected = await service.rejectApplication(TENANT_ID, application.id);

        expect(rejected.status).toBe('rejected');
        expect(rejected.reviewedAt).toBeDefined();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ─── Disbursement Tests ──────────────────────────────────────────────────

  describe('createDisbursement', () => {
    it('should create a disbursement for an approved application', async () => {
      const program = await service.createProgram(TENANT_ID, makeProgramInput());
      await service.updateProgram(TENANT_ID, program.id, { status: 'open' });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-15'));

      try {
        const application = await service.submitApplication(
          TENANT_ID,
          makeApplicationInput(program.id),
        );
        await service.approveApplication(TENANT_ID, application.id);

        const disbursement = await service.createDisbursement(TENANT_ID, {
          applicationId: application.id,
          amount: 2500,
          scheduledDate: '2024-04-01',
          paymentMethod: 'bank_transfer',
        });

        expect(disbursement.id).toBeDefined();
        expect(disbursement.amount).toBe(2500);
        expect(disbursement.paymentStatus).toBe('scheduled');
        expect(disbursement.paymentMethod).toBe('bank_transfer');
      } finally {
        vi.useRealTimers();
      }
    });

    it('should throw BusinessRuleError if application is not approved', async () => {
      const program = await service.createProgram(TENANT_ID, makeProgramInput());
      await service.updateProgram(TENANT_ID, program.id, { status: 'open' });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-15'));

      try {
        const application = await service.submitApplication(
          TENANT_ID,
          makeApplicationInput(program.id),
        );

        await expect(
          service.createDisbursement(TENANT_ID, {
            applicationId: application.id,
            amount: 2500,
            scheduledDate: '2024-04-01',
          }),
        ).rejects.toThrow(BusinessRuleError);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('updateDisbursement', () => {
    it('should update disbursement payment status', async () => {
      const program = await service.createProgram(TENANT_ID, makeProgramInput());
      await service.updateProgram(TENANT_ID, program.id, { status: 'open' });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-15'));

      try {
        const application = await service.submitApplication(
          TENANT_ID,
          makeApplicationInput(program.id),
        );
        await service.approveApplication(TENANT_ID, application.id);

        const disbursement = await service.createDisbursement(TENANT_ID, {
          applicationId: application.id,
          amount: 2500,
          scheduledDate: '2024-04-01',
        });

        const updated = await service.updateDisbursement(TENANT_ID, disbursement.id, {
          paymentStatus: 'paid',
          paidDate: '2024-04-01',
          transactionReference: 'TXN-12345',
        });

        expect(updated.paymentStatus).toBe('paid');
        expect(updated.paidDate).toBe('2024-04-01');
        expect(updated.transactionReference).toBe('TXN-12345');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ─── Compliance Tests ────────────────────────────────────────────────────

  describe('recordCompliance', () => {
    it('should record compliance for an approved application', async () => {
      const program = await service.createProgram(TENANT_ID, makeProgramInput());
      await service.updateProgram(TENANT_ID, program.id, { status: 'open' });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-15'));

      try {
        const application = await service.submitApplication(
          TENANT_ID,
          makeApplicationInput(program.id),
        );
        await service.approveApplication(TENANT_ID, application.id);

        const record = await service.recordCompliance(TENANT_ID, {
          applicationId: application.id,
          complianceType: 'academic_performance',
          status: 'compliant',
          evaluationDate: '2024-06-01',
          details: 'GPA maintained above 3.0',
        });

        expect(record.id).toBeDefined();
        expect(record.complianceType).toBe('academic_performance');
        expect(record.status).toBe('compliant');
      } finally {
        vi.useRealTimers();
      }
    });

    it('should throw BusinessRuleError if application is not approved', async () => {
      const program = await service.createProgram(TENANT_ID, makeProgramInput());
      await service.updateProgram(TENANT_ID, program.id, { status: 'open' });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-15'));

      try {
        const application = await service.submitApplication(
          TENANT_ID,
          makeApplicationInput(program.id),
        );

        await expect(
          service.recordCompliance(TENANT_ID, {
            applicationId: application.id,
            complianceType: 'academic_performance',
            status: 'compliant',
            evaluationDate: '2024-06-01',
          }),
        ).rejects.toThrow(BusinessRuleError);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ─── Report Tests ────────────────────────────────────────────────────────

  describe('getUtilizationReport', () => {
    it('should generate a utilization report', async () => {
      const program = await service.createProgram(TENANT_ID, makeProgramInput());
      await service.updateProgram(TENANT_ID, program.id, { status: 'open' });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-15'));

      try {
        const application = await service.submitApplication(
          TENANT_ID,
          makeApplicationInput(program.id),
        );
        await service.approveApplication(TENANT_ID, application.id);

        // Create a paid disbursement
        const disbursement = await service.createDisbursement(TENANT_ID, {
          applicationId: application.id,
          amount: 5000,
          scheduledDate: '2024-04-01',
        });
        await service.updateDisbursement(TENANT_ID, disbursement.id, {
          paymentStatus: 'paid',
          paidDate: '2024-04-01',
        });

        const report = await service.getUtilizationReport(TENANT_ID, {
          groupBy: 'program',
        });

        expect(report.totalPrograms).toBe(1);
        expect(report.totalApplications).toBe(1);
        expect(report.totalApproved).toBe(1);
        expect(report.totalDisbursed).toBe(1);
        expect(report.totalAmount).toBe(5000);
        expect(report.breakdown.length).toBeGreaterThan(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should filter report by gender', async () => {
      const program = await service.createProgram(TENANT_ID, makeProgramInput());
      await service.updateProgram(TENANT_ID, program.id, { status: 'open' });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-15'));

      try {
        await service.submitApplication(
          TENANT_ID,
          makeApplicationInput(program.id, { gender: 'female' }),
        );

        const report = await service.getUtilizationReport(TENANT_ID, {
          gender: 'male',
          groupBy: 'gender',
        });

        expect(report.totalApplications).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ─── Workflow Integration Tests ──────────────────────────────────────────

  describe('workflow integration', () => {
    it('should create workflow instance on application submission', async () => {
      const program = await service.createProgram(TENANT_ID, makeProgramInput());
      await service.updateProgram(TENANT_ID, program.id, { status: 'open' });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-15'));

      try {
        const application = await service.submitApplication(
          TENANT_ID,
          makeApplicationInput(program.id),
        );

        expect(application.workflowInstanceId).toBe('workflow-instance-001');
        expect(application.status).toBe('under_review');
      } finally {
        vi.useRealTimers();
      }
    });

    it('should handle workflow engine failure gracefully', async () => {
      const failingWorkflowEngine: WorkflowEngineClient = {
        createInstance: async () => {
          throw new Error('Workflow engine unavailable');
        },
      };
      const serviceWithFailingWf = new ScholarshipService(repository, failingWorkflowEngine);

      const program = await serviceWithFailingWf.createProgram(TENANT_ID, makeProgramInput());
      await serviceWithFailingWf.updateProgram(TENANT_ID, program.id, { status: 'open' });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-15'));

      try {
        const application = await serviceWithFailingWf.submitApplication(
          TENANT_ID,
          makeApplicationInput(program.id),
        );

        // Application should still be created, just without workflow
        expect(application.id).toBeDefined();
        expect(application.status).toBe('submitted');
        expect(application.workflowInstanceId).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('should work without workflow engine configured', async () => {
      const serviceNoWf = new ScholarshipService(repository);

      const program = await serviceNoWf.createProgram(TENANT_ID, makeProgramInput());
      await serviceNoWf.updateProgram(TENANT_ID, program.id, { status: 'open' });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-15'));

      try {
        const application = await serviceNoWf.submitApplication(
          TENANT_ID,
          makeApplicationInput(program.id),
        );

        expect(application.id).toBeDefined();
        expect(application.status).toBe('submitted');
        expect(application.workflowInstanceId).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
