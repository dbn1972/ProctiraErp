'use server';

/**
 * Server Actions for workflow definition create + approval decisions.
 */
import { revalidatePath } from 'next/cache';

import { safeActionErrorMessage } from '@/lib/api/action-error';
import {
  workflowDecisionSchema,
  workflowDefinitionInputSchema,
} from '@/lib/validation/action-input-schema';
import {
  createWorkflowDefinition,
  decideWorkflowApproval,
  type CreateWorkflowDefinitionInput,
} from '@/lib/api/workflows';

export interface WorkflowActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  definitionId?: string;
}

export async function createWorkflowDefinitionAction(
  input: CreateWorkflowDefinitionInput,
): Promise<WorkflowActionState> {
  const parsed = workflowDefinitionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid definition' };
  }
  try {
    const definition = await createWorkflowDefinition(parsed.data);
    revalidatePath('/workflows');
    revalidatePath(`/workflows/definitions/${definition.id}`);
    return {
      status: 'success',
      message: 'Definition created.',
      definitionId: definition.id,
    };
  } catch (error) {
    return {
      status: 'error',
      message: safeActionErrorMessage(error, 'Failed to create definition'),
    };
  }
}

export async function decideWorkflowApprovalAction(
  approvalId: string,
  decision: 'approve' | 'reject',
): Promise<WorkflowActionState> {
  if (!workflowDecisionSchema.safeParse({ approvalId, decision }).success) {
    return { status: 'error', message: 'Invalid approval decision.' };
  }
  try {
    await decideWorkflowApproval(approvalId, decision);
    revalidatePath('/workflows/approvals');
    revalidatePath('/workflows/instances');
    return {
      status: 'success',
      message: decision === 'approve' ? 'Approved.' : 'Rejected.',
    };
  } catch (error) {
    return {
      status: 'error',
      message: safeActionErrorMessage(error, `Failed to ${decision} approval`),
    };
  }
}
