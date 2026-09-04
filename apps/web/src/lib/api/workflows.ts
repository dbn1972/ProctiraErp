/**
 * Workflow service client.
 *
 * Maps ProctiraERP workflow-engine gateway routes onto App Router UI shapes.
 *
 * Backend:
 *   GET/POST  /workflows
 *   GET/PUT   /workflows/:id
 *   GET/POST  /workflows/instances
 *   POST      /workflows/instances/:id/transition
 *   GET       /workflows/instances/:id/audit
 *
 * Validates: Requirement 13.1 — workflow definitions, instances, approvals.
 */
import { gatewayFetch } from './gateway';

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
  description?: string | null;
  /** Raw backend states (for create/transition helpers). */
  states?: BackendWorkflowState[];
  transitions?: BackendWorkflowTransition[];
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

export interface WorkflowApprovalHistoryItem {
  id: string;
  instanceId: string;
  definitionName: string;
  subjectType: string;
  subjectId: string;
  stepName: string;
  action: string;
  decidedAt: string;
  decidedBy: string;
  status: 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'COMPLETED';
  comments?: string | null;
}

export interface WorkflowAuditEntry {
  id: string;
  instanceId: string;
  fromStateId: string;
  toStateId: string;
  action: string;
  actorId: string;
  comments: string | null;
  timestamp: string;
}

export interface CreateWorkflowDefinitionInput {
  name: string;
  entityType: string;
  description?: string;
  states: BackendWorkflowState[];
  transitions: BackendWorkflowTransition[];
  escalationRules?: Array<{
    stateId: string;
    durationMinutes: number;
    escalateToStateId: string;
    notifyRoleId?: string;
  }>;
}

interface BackendWorkflowState {
  id: string;
  name: string;
  type: 'INITIAL' | 'INTERMEDIATE' | 'FINAL';
  assigneeType: 'role' | 'user' | 'area_role';
  assigneeId: string;
  institutionScoped?: boolean;
}

interface BackendWorkflowTransition {
  id: string;
  fromStateId: string;
  toStateId: string;
  action: string;
  requiredApprovals?: number;
}

interface BackendDefinition {
  id: string;
  tenantId?: string;
  name: string;
  entityType: string;
  description?: string | null;
  states: BackendWorkflowState[];
  transitions: BackendWorkflowTransition[];
  escalationRules?: unknown;
  createdAt?: string;
  updatedAt: string;
}

interface BackendInstance {
  id: string;
  workflowDefinitionId: string;
  entityType: string;
  entityId: string;
  currentStateId: string;
  status: string;
  metadata: Record<string, unknown> | null;
  approvals: Array<{
    stateId: string;
    actorId: string;
    action: string;
    timestamp: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

function unwrapList<T>(payload: { data?: T[] } | T[] | null | undefined): T[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  return payload.data ?? [];
}

function mapDefinition(raw: BackendDefinition): WorkflowDefinition {
  const intermediate = (raw.states ?? []).filter(
    (s) => s.type === 'INTERMEDIATE',
  );
  const stepsSource =
    intermediate.length > 0
      ? intermediate
      : (raw.states ?? []).filter((s) => s.type !== 'INITIAL');

  const steps: WorkflowStep[] = stepsSource.map((s, idx) => ({
    id: s.id,
    order: idx + 1,
    name: s.name,
    approverRole: s.assigneeId,
  }));

  return {
    id: raw.id,
    name: raw.name,
    module: raw.entityType,
    version: 1,
    steps,
    active: true,
    updatedAt: raw.updatedAt,
    description: raw.description ?? null,
    states: raw.states,
    transitions: raw.transitions,
  };
}

function mapInstanceStatus(
  raw: BackendInstance,
): WorkflowInstance['status'] {
  const status = (raw.status ?? '').toUpperCase();
  if (status === 'ACTIVE' || status === 'PENDING') return 'PENDING';
  if (status === 'CANCELLED') return 'CANCELLED';
  if (status === 'REJECTED') return 'REJECTED';
  if (status === 'APPROVED') return 'APPROVED';

  // COMPLETED — infer from last approval action when possible
  const last = raw.approvals?.[raw.approvals.length - 1];
  if (last?.action?.toLowerCase().includes('reject')) return 'REJECTED';
  if (status === 'COMPLETED') return 'APPROVED';
  return 'PENDING';
}

function mapInstance(
  raw: BackendInstance,
  definitionName?: string,
  stateName?: string,
): WorkflowInstance {
  const initiatedBy =
    (raw.metadata?.initiatedBy as string | undefined) ??
    raw.approvals?.[0]?.actorId ??
    '—';

  return {
    id: raw.id,
    definitionId: raw.workflowDefinitionId,
    definitionName: definitionName ?? raw.workflowDefinitionId,
    subjectType: raw.entityType,
    subjectId: raw.entityId,
    initiatedBy,
    initiatedAt: raw.createdAt,
    currentStep: stateName ?? raw.currentStateId,
    status: mapInstanceStatus(raw),
  };
}

async function fetchDefinitionsMap(): Promise<Map<string, WorkflowDefinition>> {
  const defs = await listWorkflowDefinitions();
  return new Map(defs.map((d) => [d.id, d]));
}

export async function listWorkflowDefinitions(): Promise<WorkflowDefinition[]> {
  const result = await gatewayFetch<{ data: BackendDefinition[] } | BackendDefinition[]>(
    '/workflows?pageSize=100',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return unwrapList(result.data).map(mapDefinition);
}

export async function getWorkflowDefinition(
  id: string,
): Promise<WorkflowDefinition | null> {
  const result = await gatewayFetch<BackendDefinition>(`/workflows/${id}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data ? mapDefinition(result.data) : null;
}

export async function createWorkflowDefinition(
  input: CreateWorkflowDefinitionInput,
): Promise<WorkflowDefinition> {
  const result = await gatewayFetch<BackendDefinition>('/workflows', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new Error(result.error?.message ?? 'Failed to create workflow definition');
  }
  return mapDefinition(result.data);
}

export async function listWorkflowInstances(options?: {
  status?: string;
  entityType?: string;
}): Promise<WorkflowInstance[]> {
  const params = new URLSearchParams();
  params.set('pageSize', '100');
  if (options?.status) params.set('status', options.status);
  if (options?.entityType) params.set('entityType', options.entityType);

  const result = await gatewayFetch<{ data: BackendInstance[] } | BackendInstance[]>(
    `/workflows/instances?${params.toString()}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  const raw = unwrapList(result.data);
  const defs = await fetchDefinitionsMap();

  return raw.map((inst) => {
    const def = defs.get(inst.workflowDefinitionId);
    const stateName =
      def?.states?.find((s) => s.id === inst.currentStateId)?.name ??
      def?.steps.find((s) => s.id === inst.currentStateId)?.name;
    return mapInstance(inst, def?.name, stateName);
  });
}

export async function getWorkflowInstance(
  instanceId: string,
): Promise<WorkflowInstance | null> {
  const result = await gatewayFetch<BackendInstance>(
    `/workflows/instances/${instanceId}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  if (!result.data) return null;
  const def = await getWorkflowDefinition(result.data.workflowDefinitionId);
  const stateName =
    def?.states?.find((s) => s.id === result.data!.currentStateId)?.name ??
    def?.steps.find((s) => s.id === result.data!.currentStateId)?.name;
  return mapInstance(result.data, def?.name, stateName);
}

/**
 * Pending approvals — ACTIVE instances awaiting a transition.
 * Prefer dedicated `/workflows/approvals/pending` when present; fall back to instances.
 */
export async function listPendingApprovals(): Promise<WorkflowApproval[]> {
  const dedicated = await gatewayFetch<{ data: WorkflowApproval[] } | WorkflowApproval[]>(
    '/workflows/approvals/pending',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  if (dedicated.ok && dedicated.data) {
    const list = unwrapList(dedicated.data);
    if (list.length > 0 || dedicated.status === 200) {
      return list;
    }
  }

  const result = await gatewayFetch<{ data: BackendInstance[] } | BackendInstance[]>(
    '/workflows/instances?status=ACTIVE&pageSize=100',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  const raw = unwrapList(result.data);
  const defs = await fetchDefinitionsMap();

  return raw.map((inst) => {
    const def = defs.get(inst.workflowDefinitionId);
    const stepName =
      def?.states?.find((s) => s.id === inst.currentStateId)?.name ??
      def?.steps.find((s) => s.id === inst.currentStateId)?.name ??
      inst.currentStateId;
    const requestedBy =
      (inst.metadata?.initiatedBy as string | undefined) ??
      inst.approvals?.[0]?.actorId ??
      '—';

    return {
      id: inst.id,
      instanceId: inst.id,
      definitionName: def?.name ?? inst.workflowDefinitionId,
      subjectType: inst.entityType,
      subjectId: inst.entityId,
      stepName,
      requestedAt: inst.createdAt,
      requestedBy,
    };
  });
}

/**
 * Approval history — completed / cancelled instances (and dedicated history if available).
 */
export async function listApprovalHistory(): Promise<WorkflowApprovalHistoryItem[]> {
  const dedicated = await gatewayFetch<
    { data: WorkflowApprovalHistoryItem[] } | WorkflowApprovalHistoryItem[]
  >('/workflows/approvals/history', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (dedicated.ok && dedicated.data) {
    const list = unwrapList(dedicated.data);
    if (list.length > 0 || dedicated.status === 200) {
      return list;
    }
  }

  const result = await gatewayFetch<{ data: BackendInstance[] } | BackendInstance[]>(
    '/workflows/instances?pageSize=100',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  const raw = unwrapList(result.data).filter((inst) => {
    const s = (inst.status ?? '').toUpperCase();
    return s === 'COMPLETED' || s === 'CANCELLED' || s === 'APPROVED' || s === 'REJECTED';
  });
  const defs = await fetchDefinitionsMap();

  return raw.map((inst) => {
    const def = defs.get(inst.workflowDefinitionId);
    const last = inst.approvals?.[inst.approvals.length - 1];
    const mapped = mapInstanceStatus(inst);
    const stepName =
      def?.states?.find((s) => s.id === (last?.stateId ?? inst.currentStateId))?.name ??
      last?.stateId ??
      inst.currentStateId;

    return {
      id: inst.id,
      instanceId: inst.id,
      definitionName: def?.name ?? inst.workflowDefinitionId,
      subjectType: inst.entityType,
      subjectId: inst.entityId,
      stepName,
      action: last?.action ?? mapped.toLowerCase(),
      decidedAt: last?.timestamp ?? inst.updatedAt,
      decidedBy: last?.actorId ?? '—',
      status:
        mapped === 'PENDING'
          ? 'COMPLETED'
          : (mapped as WorkflowApprovalHistoryItem['status']),
      comments: null,
    };
  });
}

export async function transitionWorkflowInstance(
  instanceId: string,
  input: { action: string; actorId: string; comments?: string },
): Promise<WorkflowInstance> {
  const result = await gatewayFetch<BackendInstance>(
    `/workflows/instances/${instanceId}/transition`,
    {
      method: 'POST',
      json: {
        action: input.action,
        actorId: input.actorId,
        comments: input.comments,
      },
    },
  );
  if (!result.data) {
    throw new Error(result.error?.message ?? 'Failed to transition workflow');
  }
  const def = await getWorkflowDefinition(result.data.workflowDefinitionId);
  const stateName =
    def?.states?.find((s) => s.id === result.data!.currentStateId)?.name ??
    def?.steps.find((s) => s.id === result.data!.currentStateId)?.name;
  return mapInstance(result.data, def?.name, stateName);
}

export async function getWorkflowAuditHistory(
  instanceId: string,
): Promise<WorkflowAuditEntry[]> {
  const result = await gatewayFetch<{ data: WorkflowAuditEntry[] } | WorkflowAuditEntry[]>(
    `/workflows/instances/${instanceId}/audit`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return unwrapList(result.data);
}

/**
 * Build a sequential approve/reject definition from a simple step list.
 * Used by the App Router "new definition" form.
 */
export function buildDefinitionFromSteps(input: {
  name: string;
  entityType: string;
  description?: string;
  steps: Array<{ name: string; role: string }>;
}): CreateWorkflowDefinitionInput {
  const steps = input.steps.filter((s) => s.name.trim() && s.role.trim());
  if (steps.length === 0) {
    throw new Error('At least one approval step is required');
  }

  const states: BackendWorkflowState[] = [
    {
      id: 'submitted',
      name: 'Submitted',
      type: 'INITIAL',
      assigneeType: 'role',
      assigneeId: 'system',
    },
  ];

  steps.forEach((step, idx) => {
    states.push({
      id: `step_${idx + 1}`,
      name: step.name.trim(),
      type: 'INTERMEDIATE',
      assigneeType: 'role',
      assigneeId: step.role.trim(),
    });
  });

  states.push(
    {
      id: 'approved',
      name: 'Approved',
      type: 'FINAL',
      assigneeType: 'role',
      assigneeId: steps[steps.length - 1]!.role.trim(),
    },
    {
      id: 'rejected',
      name: 'Rejected',
      type: 'FINAL',
      assigneeType: 'role',
      assigneeId: steps[steps.length - 1]!.role.trim(),
    },
  );

  const transitions: BackendWorkflowTransition[] = [
    {
      id: 't_submit',
      fromStateId: 'submitted',
      toStateId: 'step_1',
      action: 'submit',
    },
  ];

  steps.forEach((_, idx) => {
    const from = `step_${idx + 1}`;
    const isLast = idx === steps.length - 1;
    transitions.push({
      id: `t_approve_${idx + 1}`,
      fromStateId: from,
      toStateId: isLast ? 'approved' : `step_${idx + 2}`,
      action: 'approve',
    });
    transitions.push({
      id: `t_reject_${idx + 1}`,
      fromStateId: from,
      toStateId: 'rejected',
      action: 'reject',
    });
  });

  return {
    name: input.name.trim(),
    entityType: input.entityType.trim(),
    description: input.description?.trim() || undefined,
    states,
    transitions,
  };
}
