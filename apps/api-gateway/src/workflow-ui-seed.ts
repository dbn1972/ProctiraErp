/**
 * Demo seed for Workflows redesign screens.
 *
 * App Router client expects:
 *   GET  /workflows/definitions
 *   GET  /workflows/definitions/:id
 *   POST /workflows/definitions
 *   GET  /workflows/instances
 *   GET  /workflows/approvals/pending
 *   POST /workflows/approvals/:id/approve|reject
 *
 * Domain engine routes use a different shape; these aggregates power the
 * redesign until Prisma-backed workflow persistence is wired through the
 * gateway with a stable UI adapter.
 */

/** Same demo tenant as Health/Scholarships so EC3 capture JWTs work. */
export const WORKFLOW_DEMO_TENANT_ID = '00000000-0000-4000-8000-0000000000aa';

export const WORKFLOW_DEF_TRANSFER_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
export const WORKFLOW_DEF_LEAVE_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
export const WORKFLOW_INSTANCE_PENDING_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
export const WORKFLOW_INSTANCE_DONE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
export const WORKFLOW_APPROVAL_PENDING_ID = 'ffffffff-ffff-4fff-8fff-fffffffffff1';

export interface UiWorkflowStep {
  id: string;
  order: number;
  name: string;
  approverRole: string;
}

export interface UiWorkflowDefinition {
  id: string;
  tenantId: string;
  name: string;
  module: string;
  version: number;
  steps: UiWorkflowStep[];
  active: boolean;
  updatedAt: string;
}

export interface UiWorkflowInstance {
  id: string;
  tenantId: string;
  definitionId: string;
  definitionName: string;
  subjectType: string;
  subjectId: string;
  initiatedBy: string;
  initiatedAt: string;
  currentStep: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
}

export interface UiWorkflowApproval {
  id: string;
  tenantId: string;
  instanceId: string;
  definitionName: string;
  subjectType: string;
  subjectId: string;
  stepName: string;
  requestedAt: string;
  requestedBy: string;
}

export interface WorkflowUiSeed {
  definitions: UiWorkflowDefinition[];
  instances: UiWorkflowInstance[];
  approvals: UiWorkflowApproval[];
}

export function createWorkflowUiSeed(): WorkflowUiSeed {
  const updatedAt = '2026-09-01T10:00:00.000Z';

  return {
    definitions: [
      {
        id: WORKFLOW_DEF_TRANSFER_ID,
        tenantId: WORKFLOW_DEMO_TENANT_ID,
        name: 'Student transfer approval',
        module: 'student',
        version: 1,
        active: true,
        updatedAt,
        steps: [
          {
            id: 'step-principal',
            order: 1,
            name: 'Principal review',
            approverRole: 'PRINCIPAL',
          },
          {
            id: 'step-district',
            order: 2,
            name: 'District approval',
            approverRole: 'DISTRICT_ADMIN',
          },
        ],
      },
      {
        id: WORKFLOW_DEF_LEAVE_ID,
        tenantId: WORKFLOW_DEMO_TENANT_ID,
        name: 'Staff leave request',
        module: 'staff',
        version: 2,
        active: true,
        updatedAt,
        steps: [
          {
            id: 'step-manager',
            order: 1,
            name: 'Manager review',
            approverRole: 'STAFF_MANAGER',
          },
          {
            id: 'step-hr',
            order: 2,
            name: 'HR confirmation',
            approverRole: 'HR_ADMIN',
          },
        ],
      },
    ],
    instances: [
      {
        id: WORKFLOW_INSTANCE_PENDING_ID,
        tenantId: WORKFLOW_DEMO_TENANT_ID,
        definitionId: WORKFLOW_DEF_TRANSFER_ID,
        definitionName: 'Student transfer approval',
        subjectType: 'student_transfer',
        subjectId: 'tr-2026-0142',
        initiatedBy: 'admin@tenant-a.test',
        initiatedAt: '2026-09-04T08:30:00.000Z',
        currentStep: 'District approval',
        status: 'PENDING',
      },
      {
        id: WORKFLOW_INSTANCE_DONE_ID,
        tenantId: WORKFLOW_DEMO_TENANT_ID,
        definitionId: WORKFLOW_DEF_LEAVE_ID,
        definitionName: 'Staff leave request',
        subjectType: 'staff_leave',
        subjectId: 'leave-9081',
        initiatedBy: 'teacher@tenant-a.test',
        initiatedAt: '2026-08-28T11:15:00.000Z',
        currentStep: 'Completed',
        status: 'APPROVED',
      },
    ],
    approvals: [
      {
        id: WORKFLOW_APPROVAL_PENDING_ID,
        tenantId: WORKFLOW_DEMO_TENANT_ID,
        instanceId: WORKFLOW_INSTANCE_PENDING_ID,
        definitionName: 'Student transfer approval',
        subjectType: 'student_transfer',
        subjectId: 'tr-2026-0142',
        stepName: 'District approval',
        requestedAt: '2026-09-04T09:00:00.000Z',
        requestedBy: 'principal@tenant-a.test',
      },
    ],
  };
}
