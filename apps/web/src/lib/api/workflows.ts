/**
 * Workflow service client.
 *
 * Validates: Requirement 13.1 — workflow definitions, instances, approvals.
 */
import { gatewayFetch, GatewayError } from './gateway';
import { fetchList, type ListResult } from './list-result';

export interface WorkflowStep {
  id: string;
  order: number;
  name: string;
  approverRole: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  module: string;
  version: number;
  steps: WorkflowStep[];
  active: boolean;
  updatedAt: string;
}

export interface WorkflowInstance {
  id: string;
  definitionId: string;
  definitionName: string;
  subjectType: string;
  subjectId: string;
  initiatedBy: string;
  initiatedAt: string;
  currentStep: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
}

export interface WorkflowApproval {
  id: string;
  instanceId: string;
  definitionName: string;
  subjectType: string;
  subjectId: string;
  stepName: string;
  requestedAt: string;
  requestedBy: string;
}

export interface CreateWorkflowDefinitionInput {
  name: string;
  module: string;
  steps: Array<{ name: string; approverRole: string }>;
}

export function listWorkflowDefinitionsResult(): Promise<ListResult<WorkflowDefinition>> {
  return fetchList<WorkflowDefinition>('/workflows/definitions', { next: { revalidate: 0 } });
}

export async function listWorkflowDefinitions(): Promise<WorkflowDefinition[]> {
  const result = await listWorkflowDefinitionsResult();
  if (!result.ok) {
    throw new GatewayError({
      status: result.status,
      code: result.kind,
      message: 'Failed to load workflow definitions',
    });
  }
  return result.items;
}

export async function getWorkflowDefinition(id: string): Promise<WorkflowDefinition | null> {
  const result = await gatewayFetch<WorkflowDefinition>(`/workflows/definitions/${id}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data;
}

export async function createWorkflowDefinition(
  input: CreateWorkflowDefinitionInput,
): Promise<WorkflowDefinition> {
  const result = await gatewayFetch<WorkflowDefinition>('/workflows/definitions', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'WORKFLOW_CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create workflow definition',
    });
  }
  return result.data;
}

export function listWorkflowInstancesResult(): Promise<ListResult<WorkflowInstance>> {
  return fetchList<WorkflowInstance>('/workflows/instances', { next: { revalidate: 0 } });
}

export async function listWorkflowInstances(): Promise<WorkflowInstance[]> {
  const result = await listWorkflowInstancesResult();
  if (!result.ok) {
    throw new GatewayError({
      status: result.status,
      code: result.kind,
      message: 'Failed to load workflow instances',
    });
  }
  return result.items;
}

export function listPendingApprovalsResult(): Promise<ListResult<WorkflowApproval>> {
  return fetchList<WorkflowApproval>('/workflows/approvals/pending', { next: { revalidate: 0 } });
}

export async function listPendingApprovals(): Promise<WorkflowApproval[]> {
  const result = await listPendingApprovalsResult();
  if (!result.ok) {
    throw new GatewayError({
      status: result.status,
      code: result.kind,
      message: 'Failed to load pending approvals',
    });
  }
  return result.items;
}

export async function decideWorkflowApproval(
  approvalId: string,
  decision: 'approve' | 'reject',
): Promise<{ id: string; instanceId: string; status: string }> {
  const result = await gatewayFetch<{
    id: string;
    instanceId: string;
    status: string;
  }>(`/workflows/approvals/${approvalId}/${decision}`, {
    method: 'POST',
    json: {},
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'WORKFLOW_DECISION_FAILED',
      message: result.error?.message ?? `Failed to ${decision} approval`,
    });
  }
  return result.data;
}
