/**
 * Grade entry publish / moderation / lock state machine (G-303 / G-907).
 *
 * DRAFT → SUBMITTED → APPROVED → LOCKED → PUBLISHED
 *          ↘ REJECTED → DRAFT (re-edit)
 *
 * Status lives in grade_entry.metadata.workflowStatus; lock also sets lockedAt;
 * publish also sets publishedAt (parent-visible).
 */
import { BusinessRuleError } from '@proctira/common';

export const GRADE_WORKFLOW_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'LOCKED',
  'PUBLISHED',
] as const;

export type GradeWorkflowStatus = (typeof GRADE_WORKFLOW_STATUSES)[number];

export const GRADE_WORKFLOW_ACTIONS = [
  'submit',
  'approve',
  'reject',
  'lock',
  'publish',
  'reopen',
] as const;

export type GradeWorkflowAction = (typeof GRADE_WORKFLOW_ACTIONS)[number];

const TRANSITIONS: Record<
  GradeWorkflowAction,
  { from: readonly GradeWorkflowStatus[]; to: GradeWorkflowStatus }
> = {
  submit: { from: ['DRAFT', 'REJECTED'], to: 'SUBMITTED' },
  approve: { from: ['SUBMITTED'], to: 'APPROVED' },
  reject: { from: ['SUBMITTED'], to: 'REJECTED' },
  lock: { from: ['APPROVED', 'LOCKED'], to: 'LOCKED' },
  publish: { from: ['LOCKED', 'PUBLISHED'], to: 'PUBLISHED' },
  reopen: { from: ['LOCKED', 'APPROVED', 'PUBLISHED'], to: 'DRAFT' },
};

export function readGradeWorkflowStatus(
  metadata: Record<string, unknown> | null | undefined,
  lockedAt?: string | null,
  publishedAt?: string | null,
): GradeWorkflowStatus {
  if (publishedAt) return 'PUBLISHED';
  if (lockedAt) return 'LOCKED';
  const raw = metadata?.workflowStatus;
  if (typeof raw === 'string' && (GRADE_WORKFLOW_STATUSES as readonly string[]).includes(raw)) {
    return raw as GradeWorkflowStatus;
  }
  return 'DRAFT';
}

export function isGradePublished(
  metadata: Record<string, unknown> | null | undefined,
  publishedAt?: string | null,
): boolean {
  if (publishedAt) return true;
  return metadata?.published === true || metadata?.workflowStatus === 'PUBLISHED';
}

export function transitionGradeWorkflow(
  current: GradeWorkflowStatus,
  action: GradeWorkflowAction,
): GradeWorkflowStatus {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(current)) {
    throw new BusinessRuleError(
      `Cannot ${action} grade in status ${current}; allowed from ${rule.from.join(', ')}`,
    );
  }
  return rule.to;
}

export function isGradeWorkflowAction(value: string): value is GradeWorkflowAction {
  return (GRADE_WORKFLOW_ACTIONS as readonly string[]).includes(value);
}
