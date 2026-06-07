/**
 * Unit tests for AppraisalService.
 *
 * Tests cover:
 * - Create appraisal template with criteria weight validation
 * - Create appraisal with score validation against template
 * - Total score calculation (weighted)
 * - Submit appraisal for workflow approval
 * - Workflow integration
 *
 * Requirements:
 * - 7.3: Staff appraisal workflows with configurable criteria, scoring on a defined
 *         numeric scale, and approval chains routed through the Workflow_Engine
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BusinessRuleError, NotFoundError } from '@proctira/common';

import {
  InMemoryAppraisalTemplateRepository,
  InMemoryAppraisalRepository,
} from './in-memory-appraisal-repository.js';
import { AppraisalService } from './appraisal-service.js';
import type { WorkflowIntegration } from './appraisal-service.js';
import { AppraisalStatus } from './appraisal-schemas.js';
import type { CreateAppraisalTemplateInput, CreateAppraisalInput } from './appraisal-schemas.js';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const TENANT_ID = uuid();

function validTemplateInput(overrides: Partial<CreateAppraisalTemplateInput> = {}): CreateAppraisalTemplateInput {
  return {
    name: 'Annual Performance Review',
    academicPeriodId: uuid(),
    criteria: [
      { name: 'Teaching Quality', weight: 40, maxScore: 10 },
      { name: 'Student Engagement', weight: 30, maxScore: 10 },
      { name: 'Professional Development', weight: 30, maxScore: 10 },
    ],
    scoreMin: 0,
    scoreMax: 100,
    ...overrides,
  };
}

describe('AppraisalService', () => {
  let templateRepo: InMemoryAppraisalTemplateRepository;
  let appraisalRepo: InMemoryAppraisalRepository;
  let service: AppraisalService;

  beforeEach(() => {
    templateRepo = new InMemoryAppraisalTemplateRepository();
    appraisalRepo = new InMemoryAppraisalRepository();
    service = new AppraisalService(templateRepo, appraisalRepo);
  });

  describe('createTemplate', () => {
    it('should create a template with valid criteria', async () => {
      const input = validTemplateInput();
      const result = await service.createTemplate(TENANT_ID, input);

      expect(result.id).toBeDefined();
      expect(result.name).toBe(input.name);
      expect(result.criteria).toHaveLength(3);
      expect(result.scoreMin).toBe(0);
      expect(result.scoreMax).toBe(100);
      expect(result.tenantId).toBe(TENANT_ID);
    });

    it('should throw BusinessRuleError when criteria weights do not sum to 100', async () => {
      const input = validTemplateInput({
        criteria: [
          { name: 'A', weight: 40, maxScore: 10 },
          { name: 'B', weight: 30, maxScore: 10 },
          // Missing 30% - total is 70
        ],
      });

      await expect(service.createTemplate(TENANT_ID, input)).rejects.toThrow(BusinessRuleError);
      await expect(service.createTemplate(TENANT_ID, input)).rejects.toThrow(
        'Criteria weights must sum to 100, but got 70',
      );
    });

    it('should throw BusinessRuleError when scoreMin >= scoreMax', async () => {
      const input = validTemplateInput({ scoreMin: 100, scoreMax: 50 });

      await expect(service.createTemplate(TENANT_ID, input)).rejects.toThrow(BusinessRuleError);
      await expect(service.createTemplate(TENANT_ID, input)).rejects.toThrow(
        'scoreMin (100) must be less than scoreMax (50)',
      );
    });

    it('should throw BusinessRuleError when scoreMin equals scoreMax', async () => {
      const input = validTemplateInput({ scoreMin: 50, scoreMax: 50 });

      await expect(service.createTemplate(TENANT_ID, input)).rejects.toThrow(BusinessRuleError);
    });

    it('should store description as null when not provided', async () => {
      const input = validTemplateInput();
      delete (input as Record<string, unknown>).description;
      const result = await service.createTemplate(TENANT_ID, input);

      expect(result.description).toBeNull();
    });
  });

  describe('getTemplate', () => {
    it('should return a template by ID', async () => {
      const input = validTemplateInput();
      const created = await service.createTemplate(TENANT_ID, input);

      const found = await service.getTemplate(TENANT_ID, created.id);
      expect(found.id).toBe(created.id);
      expect(found.name).toBe(input.name);
    });

    it('should throw NotFoundError when template does not exist', async () => {
      await expect(service.getTemplate(TENANT_ID, uuid())).rejects.toThrow(NotFoundError);
    });
  });

  describe('createAppraisal', () => {
    let templateId: string;

    beforeEach(async () => {
      const template = await service.createTemplate(TENANT_ID, validTemplateInput());
      templateId = template.id;
    });

    it('should create an appraisal with valid scores', async () => {
      const input: CreateAppraisalInput = {
        staffId: uuid(),
        templateId,
        appraisalDate: '2024-06-15',
        scores: [
          { criterionName: 'Teaching Quality', score: 8 },
          { criterionName: 'Student Engagement', score: 7 },
          { criterionName: 'Professional Development', score: 9 },
        ],
      };

      const result = await service.createAppraisal(TENANT_ID, input);

      expect(result.id).toBeDefined();
      expect(result.staffId).toBe(input.staffId);
      expect(result.templateId).toBe(templateId);
      expect(result.status).toBe(AppraisalStatus.DRAFT);
      expect(result.scores).toHaveLength(3);
      expect(result.totalScore).toBeGreaterThan(0);
      expect(result.workflowInstanceId).toBeNull();
    });

    it('should calculate total score correctly using weighted formula', async () => {
      // Template: Teaching Quality (40%, max 10), Student Engagement (30%, max 10), Professional Development (30%, max 10)
      // Score range: 0-100
      // Scores: 10/10, 10/10, 10/10 → all perfect → total should be 100
      const input: CreateAppraisalInput = {
        staffId: uuid(),
        templateId,
        appraisalDate: '2024-06-15',
        scores: [
          { criterionName: 'Teaching Quality', score: 10 },
          { criterionName: 'Student Engagement', score: 10 },
          { criterionName: 'Professional Development', score: 10 },
        ],
      };

      const result = await service.createAppraisal(TENANT_ID, input);
      expect(result.totalScore).toBe(100);
    });

    it('should calculate partial total score correctly', async () => {
      // Scores: 5/10, 5/10, 5/10 → all 50% → total should be 50
      const input: CreateAppraisalInput = {
        staffId: uuid(),
        templateId,
        appraisalDate: '2024-06-15',
        scores: [
          { criterionName: 'Teaching Quality', score: 5 },
          { criterionName: 'Student Engagement', score: 5 },
          { criterionName: 'Professional Development', score: 5 },
        ],
      };

      const result = await service.createAppraisal(TENANT_ID, input);
      expect(result.totalScore).toBe(50);
    });

    it('should throw NotFoundError when template does not exist', async () => {
      const input: CreateAppraisalInput = {
        staffId: uuid(),
        templateId: uuid(),
        appraisalDate: '2024-06-15',
        scores: [{ criterionName: 'Teaching Quality', score: 8 }],
      };

      await expect(service.createAppraisal(TENANT_ID, input)).rejects.toThrow(NotFoundError);
    });

    it('should throw BusinessRuleError when a criterion is missing from scores', async () => {
      const input: CreateAppraisalInput = {
        staffId: uuid(),
        templateId,
        appraisalDate: '2024-06-15',
        scores: [
          { criterionName: 'Teaching Quality', score: 8 },
          // Missing 'Student Engagement' and 'Professional Development'
        ],
      };

      await expect(service.createAppraisal(TENANT_ID, input)).rejects.toThrow(BusinessRuleError);
      await expect(service.createAppraisal(TENANT_ID, input)).rejects.toThrow(
        "Missing score for criterion 'Student Engagement'",
      );
    });

    it('should throw BusinessRuleError when an unknown criterion is scored', async () => {
      const input: CreateAppraisalInput = {
        staffId: uuid(),
        templateId,
        appraisalDate: '2024-06-15',
        scores: [
          { criterionName: 'Teaching Quality', score: 8 },
          { criterionName: 'Student Engagement', score: 7 },
          { criterionName: 'Professional Development', score: 9 },
          { criterionName: 'Unknown Criterion', score: 5 },
        ],
      };

      await expect(service.createAppraisal(TENANT_ID, input)).rejects.toThrow(BusinessRuleError);
      await expect(service.createAppraisal(TENANT_ID, input)).rejects.toThrow(
        "Unknown criterion 'Unknown Criterion'",
      );
    });

    it('should throw BusinessRuleError when score exceeds criterion maxScore', async () => {
      const input: CreateAppraisalInput = {
        staffId: uuid(),
        templateId,
        appraisalDate: '2024-06-15',
        scores: [
          { criterionName: 'Teaching Quality', score: 15 }, // max is 10
          { criterionName: 'Student Engagement', score: 7 },
          { criterionName: 'Professional Development', score: 9 },
        ],
      };

      await expect(service.createAppraisal(TENANT_ID, input)).rejects.toThrow(BusinessRuleError);
      await expect(service.createAppraisal(TENANT_ID, input)).rejects.toThrow(
        "Score for 'Teaching Quality' must be between 0 and 10, got 15",
      );
    });

    it('should throw BusinessRuleError when score is negative', async () => {
      const input: CreateAppraisalInput = {
        staffId: uuid(),
        templateId,
        appraisalDate: '2024-06-15',
        scores: [
          { criterionName: 'Teaching Quality', score: -1 },
          { criterionName: 'Student Engagement', score: 7 },
          { criterionName: 'Professional Development', score: 9 },
        ],
      };

      await expect(service.createAppraisal(TENANT_ID, input)).rejects.toThrow(BusinessRuleError);
    });
  });

  describe('submitAppraisal', () => {
    let templateId: string;

    beforeEach(async () => {
      const template = await service.createTemplate(TENANT_ID, validTemplateInput());
      templateId = template.id;
    });

    it('should submit a DRAFT appraisal and change status to SUBMITTED', async () => {
      const appraisal = await service.createAppraisal(TENANT_ID, {
        staffId: uuid(),
        templateId,
        appraisalDate: '2024-06-15',
        scores: [
          { criterionName: 'Teaching Quality', score: 8 },
          { criterionName: 'Student Engagement', score: 7 },
          { criterionName: 'Professional Development', score: 9 },
        ],
      });

      const submitted = await service.submitAppraisal(TENANT_ID, appraisal.id);

      expect(submitted.status).toBe(AppraisalStatus.SUBMITTED);
    });

    it('should throw BusinessRuleError when appraisal is not in DRAFT status', async () => {
      const appraisal = await service.createAppraisal(TENANT_ID, {
        staffId: uuid(),
        templateId,
        appraisalDate: '2024-06-15',
        scores: [
          { criterionName: 'Teaching Quality', score: 8 },
          { criterionName: 'Student Engagement', score: 7 },
          { criterionName: 'Professional Development', score: 9 },
        ],
      });

      // Submit once
      await service.submitAppraisal(TENANT_ID, appraisal.id);

      // Try to submit again
      await expect(service.submitAppraisal(TENANT_ID, appraisal.id)).rejects.toThrow(
        BusinessRuleError,
      );
    });

    it('should throw NotFoundError when appraisal does not exist', async () => {
      await expect(service.submitAppraisal(TENANT_ID, uuid())).rejects.toThrow(NotFoundError);
    });

    it('should integrate with workflow engine on submit', async () => {
      const mockWorkflow: WorkflowIntegration = {
        createInstance: vi.fn().mockResolvedValue('workflow-instance-123'),
      };

      const serviceWithWorkflow = new AppraisalService(
        templateRepo,
        appraisalRepo,
        mockWorkflow,
      );

      const appraisal = await serviceWithWorkflow.createAppraisal(TENANT_ID, {
        staffId: uuid(),
        templateId,
        appraisalDate: '2024-06-15',
        scores: [
          { criterionName: 'Teaching Quality', score: 8 },
          { criterionName: 'Student Engagement', score: 7 },
          { criterionName: 'Professional Development', score: 9 },
        ],
      });

      const submitted = await serviceWithWorkflow.submitAppraisal(TENANT_ID, appraisal.id);

      expect(mockWorkflow.createInstance).toHaveBeenCalledWith(
        TENANT_ID,
        'staff_appraisal',
        'appraisal',
        appraisal.id,
      );
      expect(submitted.workflowInstanceId).toBe('workflow-instance-123');
      expect(submitted.status).toBe(AppraisalStatus.SUBMITTED);
    });
  });

  describe('listAppraisals', () => {
    let templateId: string;

    beforeEach(async () => {
      const template = await service.createTemplate(TENANT_ID, validTemplateInput());
      templateId = template.id;
    });

    it('should list appraisals with pagination', async () => {
      const staffId = uuid();
      for (let i = 0; i < 3; i++) {
        await service.createAppraisal(TENANT_ID, {
          staffId,
          templateId,
          appraisalDate: `2024-0${i + 1}-15`,
          scores: [
            { criterionName: 'Teaching Quality', score: 8 },
            { criterionName: 'Student Engagement', score: 7 },
            { criterionName: 'Professional Development', score: 9 },
          ],
        });
      }

      const result = await service.listAppraisals(TENANT_ID, {}, { page: 1, pageSize: 20 });
      expect(result.data).toHaveLength(3);
      expect(result.meta.totalItems).toBe(3);
    });

    it('should filter by staffId', async () => {
      const staffId1 = uuid();
      const staffId2 = uuid();

      await service.createAppraisal(TENANT_ID, {
        staffId: staffId1,
        templateId,
        appraisalDate: '2024-01-15',
        scores: [
          { criterionName: 'Teaching Quality', score: 8 },
          { criterionName: 'Student Engagement', score: 7 },
          { criterionName: 'Professional Development', score: 9 },
        ],
      });
      await service.createAppraisal(TENANT_ID, {
        staffId: staffId2,
        templateId,
        appraisalDate: '2024-02-15',
        scores: [
          { criterionName: 'Teaching Quality', score: 6 },
          { criterionName: 'Student Engagement', score: 5 },
          { criterionName: 'Professional Development', score: 7 },
        ],
      });

      const result = await service.listAppraisals(
        TENANT_ID,
        { staffId: staffId1 },
        { page: 1, pageSize: 20 },
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.staffId).toBe(staffId1);
    });
  });
});
