/**
 * Unit tests for AssignmentService
 *
 * Tests workflow step assignment based on role and area hierarchy context.
 *
 * Requirements: 13.2
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { AssignmentService, InMemoryAreaHierarchyResolver } from './assignment-service.js';
import type { WorkflowStateInput } from './schemas.js';

const TENANT_ID = 'tenant-assign-001';

describe('AssignmentService', () => {
  let service: AssignmentService;
  let areaResolver: InMemoryAreaHierarchyResolver;

  beforeEach(() => {
    areaResolver = new InMemoryAreaHierarchyResolver();
    service = new AssignmentService(areaResolver);

    // Set up area hierarchy: Country → Region → District → School Area
    areaResolver.addArea({ id: 'country-1', parentId: null, name: 'Country', level: 1 });
    areaResolver.addArea({ id: 'region-1', parentId: 'country-1', name: 'North Region', level: 2 });
    areaResolver.addArea({ id: 'district-1', parentId: 'region-1', name: 'District A', level: 3 });
    areaResolver.addArea({
      id: 'school-area-1',
      parentId: 'district-1',
      name: 'School Area 1',
      level: 4,
    });

    // Set up institution-area mapping
    areaResolver.setInstitutionArea('institution-001', 'school-area-1');
    areaResolver.setInstitutionArea('institution-002', 'district-1');
  });

  // ─── Role-Based Assignment ───────────────────────────────────────────────

  describe('resolveAssignment - role type', () => {
    it('should resolve role-based assignment', async () => {
      const state: WorkflowStateInput = {
        id: 'review',
        name: 'Review',
        type: 'INTERMEDIATE',
        assigneeType: 'role',
        assigneeId: 'school_admin',
      };

      const result = await service.resolveAssignment(state, {
        tenantId: TENANT_ID,
        institutionId: 'institution-001',
      });

      expect(result.type).toBe('role');
      expect(result.targetId).toBe('school_admin');
      expect(result.institutionScoped).toBe(false);
    });

    it('should resolve institution-scoped role assignment', async () => {
      const state: WorkflowStateInput = {
        id: 'review',
        name: 'Review',
        type: 'INTERMEDIATE',
        assigneeType: 'role',
        assigneeId: 'principal',
        institutionScoped: true,
      };

      const result = await service.resolveAssignment(state, {
        tenantId: TENANT_ID,
        institutionId: 'institution-001',
      });

      expect(result.type).toBe('role');
      expect(result.targetId).toBe('principal');
      expect(result.institutionScoped).toBe(true);
      expect(result.institutionId).toBe('institution-001');
    });
  });

  // ─── User-Based Assignment ───────────────────────────────────────────────

  describe('resolveAssignment - user type', () => {
    it('should resolve user-based assignment', async () => {
      const state: WorkflowStateInput = {
        id: 'draft',
        name: 'Draft',
        type: 'INITIAL',
        assigneeType: 'user',
        assigneeId: 'user-123',
      };

      const result = await service.resolveAssignment(state, {
        tenantId: TENANT_ID,
      });

      expect(result.type).toBe('user');
      expect(result.targetId).toBe('user-123');
      expect(result.institutionScoped).toBe(false);
    });

    it('should include institution context for user assignment', async () => {
      const state: WorkflowStateInput = {
        id: 'assigned',
        name: 'Assigned',
        type: 'INTERMEDIATE',
        assigneeType: 'user',
        assigneeId: 'specific-user',
        institutionScoped: true,
      };

      const result = await service.resolveAssignment(state, {
        tenantId: TENANT_ID,
        institutionId: 'institution-001',
      });

      expect(result.type).toBe('user');
      expect(result.targetId).toBe('specific-user');
      expect(result.institutionScoped).toBe(true);
      expect(result.institutionId).toBe('institution-001');
    });
  });

  // ─── Area-Role Assignment ────────────────────────────────────────────────

  describe('resolveAssignment - area_role type', () => {
    it('should resolve area-role assignment with direct area context', async () => {
      const state: WorkflowStateInput = {
        id: 'district_review',
        name: 'District Review',
        type: 'INTERMEDIATE',
        assigneeType: 'area_role',
        assigneeId: 'district_officer',
      };

      const result = await service.resolveAssignment(state, {
        tenantId: TENANT_ID,
        areaId: 'district-1',
      });

      expect(result.type).toBe('area_role');
      expect(result.targetId).toBe('district_officer');
      expect(result.areaId).toBe('district-1');
    });

    it('should resolve area from institution when no area provided', async () => {
      const state: WorkflowStateInput = {
        id: 'area_review',
        name: 'Area Review',
        type: 'INTERMEDIATE',
        assigneeType: 'area_role',
        assigneeId: 'area_supervisor',
      };

      const result = await service.resolveAssignment(state, {
        tenantId: TENANT_ID,
        institutionId: 'institution-001',
      });

      expect(result.type).toBe('area_role');
      expect(result.targetId).toBe('area_supervisor');
      expect(result.areaId).toBe('school-area-1');
    });

    it('should handle missing area and institution gracefully', async () => {
      const state: WorkflowStateInput = {
        id: 'review',
        name: 'Review',
        type: 'INTERMEDIATE',
        assigneeType: 'area_role',
        assigneeId: 'reviewer',
      };

      const result = await service.resolveAssignment(state, {
        tenantId: TENANT_ID,
      });

      expect(result.type).toBe('area_role');
      expect(result.targetId).toBe('reviewer');
      expect(result.areaId).toBeUndefined();
    });
  });

  // ─── Escalation Target Resolution ───────────────────────────────────────

  describe('resolveEscalationTarget', () => {
    it('should resolve escalation target to parent area', async () => {
      const result = await service.resolveEscalationTarget(
        TENANT_ID,
        'school-area-1',
        'supervisor',
      );

      expect(result).not.toBeNull();
      expect(result!.type).toBe('area_role');
      expect(result!.targetId).toBe('supervisor');
      expect(result!.areaId).toBe('district-1');
    });

    it('should resolve escalation through multiple levels', async () => {
      // First escalation: school-area → district
      const first = await service.resolveEscalationTarget(TENANT_ID, 'school-area-1', 'manager');
      expect(first!.areaId).toBe('district-1');

      // Second escalation: district → region
      const second = await service.resolveEscalationTarget(TENANT_ID, 'district-1', 'manager');
      expect(second!.areaId).toBe('region-1');

      // Third escalation: region → country
      const third = await service.resolveEscalationTarget(TENANT_ID, 'region-1', 'manager');
      expect(third!.areaId).toBe('country-1');
    });

    it('should return null when at root level (cannot escalate further)', async () => {
      const result = await service.resolveEscalationTarget(TENANT_ID, 'country-1', 'supervisor');

      expect(result).toBeNull();
    });

    it('should return null for non-existent area', async () => {
      const result = await service.resolveEscalationTarget(
        TENANT_ID,
        'non-existent-area',
        'supervisor',
      );

      expect(result).toBeNull();
    });
  });
});
