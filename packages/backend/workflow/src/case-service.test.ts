/**
 * Unit tests for CaseService
 *
 * Tests case management: creation, status transitions, attachments, and resolution.
 *
 * Requirements: 13.5
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundError, BusinessRuleError } from '@proctira/common';

import { CaseService } from './case-service.js';
import { InMemoryCaseRepository } from './in-memory-case-repository.js';
import type { CreateCaseInput } from './case-schemas.js';

const TENANT_ID = 'tenant-case-001';

function createValidCaseInput(overrides?: Partial<CreateCaseInput>): CreateCaseInput {
  return {
    type: 'disciplinary',
    title: 'Student Misconduct Report',
    description: 'Student was involved in a fight during recess',
    entityType: 'student',
    entityId: 'student-001',
    institutionId: '550e8400-e29b-41d4-a716-446655440000',
    assignedTo: 'principal-001',
    priority: 'high',
    ...overrides,
  };
}

describe('CaseService', () => {
  let service: CaseService;
  let repository: InMemoryCaseRepository;

  beforeEach(() => {
    repository = new InMemoryCaseRepository();
    service = new CaseService(repository);
  });

  // ─── Case Creation ───────────────────────────────────────────────────────

  describe('createCase', () => {
    it('should create a disciplinary case with open status', async () => {
      const input = createValidCaseInput();
      const result = await service.createCase(TENANT_ID, input);

      expect(result.id).toBeDefined();
      expect(result.tenantId).toBe(TENANT_ID);
      expect(result.type).toBe('disciplinary');
      expect(result.title).toBe(input.title);
      expect(result.description).toBe(input.description);
      expect(result.status).toBe('open');
      expect(result.entityType).toBe('student');
      expect(result.entityId).toBe('student-001');
      expect(result.assignedTo).toBe('principal-001');
      expect(result.priority).toBe('high');
      expect(result.attachments).toEqual([]);
      expect(result.resolution).toBeNull();
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('should create a counselling case', async () => {
      const input = createValidCaseInput({
        type: 'counselling',
        title: 'Student Counselling Session',
      });
      const result = await service.createCase(TENANT_ID, input);

      expect(result.type).toBe('counselling');
      expect(result.status).toBe('open');
    });

    it('should create a complaint case', async () => {
      const input = createValidCaseInput({ type: 'complaint', title: 'Parent Complaint' });
      const result = await service.createCase(TENANT_ID, input);

      expect(result.type).toBe('complaint');
      expect(result.status).toBe('open');
    });

    it('should default priority to medium when not specified', async () => {
      const input = createValidCaseInput();
      delete (input as Record<string, unknown>).priority;
      const result = await service.createCase(TENANT_ID, input);

      expect(result.priority).toBe('medium');
    });

    it('should create case with initial attachments', async () => {
      const input = createValidCaseInput({
        attachments: [
          {
            id: 'att-001',
            fileName: 'incident-report.pdf',
            fileType: 'application/pdf',
            fileSize: 1024,
            storagePath: '/uploads/incident-report.pdf',
            uploadedBy: 'teacher-001',
          },
        ],
      });
      const result = await service.createCase(TENANT_ID, input);

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]!.fileName).toBe('incident-report.pdf');
    });
  });

  // ─── Get Case ────────────────────────────────────────────────────────────

  describe('getCase', () => {
    it('should return a case by ID', async () => {
      const created = await service.createCase(TENANT_ID, createValidCaseInput());
      const result = await service.getCase(TENANT_ID, created.id);

      expect(result.id).toBe(created.id);
      expect(result.title).toBe(created.title);
    });

    it('should throw NotFoundError for non-existent case', async () => {
      await expect(service.getCase(TENANT_ID, 'non-existent')).rejects.toThrow(NotFoundError);
    });
  });

  // ─── Update Case ─────────────────────────────────────────────────────────

  describe('updateCase', () => {
    it('should update case title and description', async () => {
      const created = await service.createCase(TENANT_ID, createValidCaseInput());
      const result = await service.updateCase(TENANT_ID, created.id, {
        title: 'Updated Title',
        description: 'Updated description',
      });

      expect(result.title).toBe('Updated Title');
      expect(result.description).toBe('Updated description');
    });

    it('should transition case status from open to in_progress', async () => {
      const created = await service.createCase(TENANT_ID, createValidCaseInput());
      const result = await service.updateCase(TENANT_ID, created.id, {
        status: 'in_progress',
      });

      expect(result.status).toBe('in_progress');
    });

    it('should transition case status from in_progress to pending_review', async () => {
      const created = await service.createCase(TENANT_ID, createValidCaseInput());
      await service.updateCase(TENANT_ID, created.id, { status: 'in_progress' });
      const result = await service.updateCase(TENANT_ID, created.id, { status: 'pending_review' });

      expect(result.status).toBe('pending_review');
    });

    it('should throw BusinessRuleError for invalid status transition', async () => {
      const created = await service.createCase(TENANT_ID, createValidCaseInput());

      // Cannot go directly from open to resolved
      await expect(
        service.updateCase(TENANT_ID, created.id, { status: 'resolved' }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should throw BusinessRuleError when modifying a closed case', async () => {
      const created = await service.createCase(TENANT_ID, createValidCaseInput());
      await service.updateCase(TENANT_ID, created.id, { status: 'closed' });

      await expect(
        service.updateCase(TENANT_ID, created.id, { title: 'New Title' }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should throw NotFoundError for non-existent case', async () => {
      await expect(service.updateCase(TENANT_ID, 'non-existent', { title: 'New' })).rejects.toThrow(
        NotFoundError,
      );
    });

    it('should allow escalation from open status', async () => {
      const created = await service.createCase(TENANT_ID, createValidCaseInput());
      const result = await service.updateCase(TENANT_ID, created.id, { status: 'escalated' });

      expect(result.status).toBe('escalated');
    });

    it('should allow escalation from in_progress status', async () => {
      const created = await service.createCase(TENANT_ID, createValidCaseInput());
      await service.updateCase(TENANT_ID, created.id, { status: 'in_progress' });
      const result = await service.updateCase(TENANT_ID, created.id, { status: 'escalated' });

      expect(result.status).toBe('escalated');
    });
  });

  // ─── Attachments ─────────────────────────────────────────────────────────

  describe('addAttachment', () => {
    it('should add an attachment to a case', async () => {
      const created = await service.createCase(TENANT_ID, createValidCaseInput());
      const result = await service.addAttachment(TENANT_ID, created.id, {
        fileName: 'evidence.jpg',
        fileType: 'image/jpeg',
        fileSize: 2048,
        storagePath: '/uploads/evidence.jpg',
        uploadedBy: 'teacher-001',
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]!.fileName).toBe('evidence.jpg');
      expect(result.attachments[0]!.id).toBeDefined();
      expect(result.attachments[0]!.uploadedAt).toBeDefined();
    });

    it('should add multiple attachments', async () => {
      const created = await service.createCase(TENANT_ID, createValidCaseInput());

      await service.addAttachment(TENANT_ID, created.id, {
        fileName: 'file1.pdf',
        fileType: 'application/pdf',
        fileSize: 1024,
        storagePath: '/uploads/file1.pdf',
        uploadedBy: 'user-001',
      });

      const result = await service.addAttachment(TENANT_ID, created.id, {
        fileName: 'file2.pdf',
        fileType: 'application/pdf',
        fileSize: 2048,
        storagePath: '/uploads/file2.pdf',
        uploadedBy: 'user-001',
      });

      expect(result.attachments).toHaveLength(2);
    });

    it('should throw BusinessRuleError when adding attachment to closed case', async () => {
      const created = await service.createCase(TENANT_ID, createValidCaseInput());
      await service.updateCase(TENANT_ID, created.id, { status: 'closed' });

      await expect(
        service.addAttachment(TENANT_ID, created.id, {
          fileName: 'late.pdf',
          fileType: 'application/pdf',
          fileSize: 512,
          storagePath: '/uploads/late.pdf',
          uploadedBy: 'user-001',
        }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should throw NotFoundError for non-existent case', async () => {
      await expect(
        service.addAttachment(TENANT_ID, 'non-existent', {
          fileName: 'file.pdf',
          fileType: 'application/pdf',
          fileSize: 512,
          storagePath: '/uploads/file.pdf',
          uploadedBy: 'user-001',
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ─── Resolution ──────────────────────────────────────────────────────────

  describe('resolveCase', () => {
    it('should resolve a case in pending_review status', async () => {
      const created = await service.createCase(TENANT_ID, createValidCaseInput());
      await service.updateCase(TENANT_ID, created.id, { status: 'in_progress' });
      await service.updateCase(TENANT_ID, created.id, { status: 'pending_review' });

      const result = await service.resolveCase(TENANT_ID, created.id, {
        outcome: 'Student received verbal warning',
        resolvedBy: 'principal-001',
        notes: 'Parents were notified',
        followUpRequired: true,
        followUpDate: '2024-02-15',
      });

      expect(result.status).toBe('resolved');
      expect(result.resolution).toBeDefined();
      expect(result.resolution!.outcome).toBe('Student received verbal warning');
      expect(result.resolution!.resolvedBy).toBe('principal-001');
      expect(result.resolution!.resolvedAt).toBeDefined();
      expect(result.resolution!.notes).toBe('Parents were notified');
      expect(result.resolution!.followUpRequired).toBe(true);
      expect(result.resolution!.followUpDate).toBe('2024-02-15');
    });

    it('should throw BusinessRuleError when resolving from open status', async () => {
      const created = await service.createCase(TENANT_ID, createValidCaseInput());

      await expect(
        service.resolveCase(TENANT_ID, created.id, {
          outcome: 'Resolved',
          resolvedBy: 'admin-001',
        }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should throw BusinessRuleError when resolving an already resolved case', async () => {
      const created = await service.createCase(TENANT_ID, createValidCaseInput());
      await service.updateCase(TENANT_ID, created.id, { status: 'in_progress' });
      await service.updateCase(TENANT_ID, created.id, { status: 'pending_review' });
      await service.resolveCase(TENANT_ID, created.id, {
        outcome: 'First resolution',
        resolvedBy: 'admin-001',
      });

      await expect(
        service.resolveCase(TENANT_ID, created.id, {
          outcome: 'Second resolution',
          resolvedBy: 'admin-001',
        }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should throw BusinessRuleError when resolving a closed case', async () => {
      const created = await service.createCase(TENANT_ID, createValidCaseInput());
      await service.updateCase(TENANT_ID, created.id, { status: 'closed' });

      await expect(
        service.resolveCase(TENANT_ID, created.id, {
          outcome: 'Resolved',
          resolvedBy: 'admin-001',
        }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should throw NotFoundError for non-existent case', async () => {
      await expect(
        service.resolveCase(TENANT_ID, 'non-existent', {
          outcome: 'Resolved',
          resolvedBy: 'admin-001',
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ─── List Cases ──────────────────────────────────────────────────────────

  describe('listCases', () => {
    it('should list cases with pagination', async () => {
      await service.createCase(TENANT_ID, createValidCaseInput({ title: 'Case 1' }));
      await service.createCase(TENANT_ID, createValidCaseInput({ title: 'Case 2' }));
      await service.createCase(TENANT_ID, createValidCaseInput({ title: 'Case 3' }));

      const result = await service.listCases(TENANT_ID, {}, { page: 1, pageSize: 2 });

      expect(result.data).toHaveLength(2);
      expect(result.meta.totalItems).toBe(3);
      expect(result.meta.totalPages).toBe(2);
    });

    it('should filter cases by type', async () => {
      await service.createCase(TENANT_ID, createValidCaseInput({ type: 'disciplinary' }));
      await service.createCase(TENANT_ID, createValidCaseInput({ type: 'counselling' }));
      await service.createCase(TENANT_ID, createValidCaseInput({ type: 'complaint' }));

      const result = await service.listCases(
        TENANT_ID,
        { type: 'disciplinary' },
        { page: 1, pageSize: 20 },
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.type).toBe('disciplinary');
    });

    it('should filter cases by status', async () => {
      const case1 = await service.createCase(
        TENANT_ID,
        createValidCaseInput({ title: 'Open Case' }),
      );
      await service.createCase(TENANT_ID, createValidCaseInput({ title: 'Another Open Case' }));
      await service.updateCase(TENANT_ID, case1.id, { status: 'in_progress' });

      const result = await service.listCases(
        TENANT_ID,
        { status: 'in_progress' },
        { page: 1, pageSize: 20 },
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.status).toBe('in_progress');
    });

    it('should filter cases by assignee', async () => {
      await service.createCase(TENANT_ID, createValidCaseInput({ assignedTo: 'user-A' }));
      await service.createCase(TENANT_ID, createValidCaseInput({ assignedTo: 'user-B' }));

      const result = await service.listCases(
        TENANT_ID,
        { assignedTo: 'user-A' },
        { page: 1, pageSize: 20 },
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.assignedTo).toBe('user-A');
    });
  });

  // ─── Valid Transitions ───────────────────────────────────────────────────

  describe('getValidTransitions', () => {
    it('should return valid transitions for open status', () => {
      const transitions = service.getValidTransitions('open');
      expect(transitions).toContain('in_progress');
      expect(transitions).toContain('escalated');
      expect(transitions).toContain('closed');
    });

    it('should return empty array for closed status', () => {
      const transitions = service.getValidTransitions('closed');
      expect(transitions).toHaveLength(0);
    });

    it('should return valid transitions for pending_review status', () => {
      const transitions = service.getValidTransitions('pending_review');
      expect(transitions).toContain('resolved');
      expect(transitions).toContain('in_progress');
      expect(transitions).toContain('escalated');
    });
  });
});
