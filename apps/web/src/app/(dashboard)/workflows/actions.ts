'use server';

/**
 * Server Actions for Workflow App Router pages (ProctiraERP).
 *
 * Approve / reject via POST /workflows/instances/:id/transition.
 * Create definitions via POST /workflows.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { GatewayError } from '@/lib/api/gateway';
import {
  buildDefinitionFromSteps,
  createWorkflowDefinition,
  transitionWorkflowInstance,
} from '@/lib/api/workflows';
import { requireSession } from '@/lib/auth/server';

export interface ActionState<T = unknown> {
  status: 'idle' | 'success' | 'error';
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: T;
  definitionId?: string;
}

export type CreateDefinitionInput = {
  name: string;
  module: string;
  steps: Array<{ name: string; approverRole: string }>;
  description?: string;
};

function toErrorState<T = unknown>(
  error: unknown,
  fallback: string,
): ActionState<T> {
  if (error instanceof GatewayError) {
    return { status: 'error', message: error.message || fallback };
  }
  if (error instanceof Error) {
    return { status: 'error', message: error.message };
  }
  return { status: 'error', message: fallback };
}

function isRedirectError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'digest' in error &&
    String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')
  );
}

function parseFormSteps(raw: string): Array<{ name: string; role: string }> {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [stepName, role] = line.split(',').map((p) => p.trim());
      return { name: stepName ?? '', role: role ?? '' };
    })
    .filter((s) => s.name && s.role);
}

async function createDefinitionFromParts(input: {
  name: string;
  module: string;
  description?: string;
  steps: Array<{ name: string; role: string }>;
  redirectOnSuccess: boolean;
}): Promise<ActionState<{ definitionId: string }>> {
  const name = input.name.trim();
  const moduleName = input.module.trim();
  const steps = input.steps.filter((s) => s.name.trim() && s.role.trim());

  if (!name) {
    return {
      status: 'error',
      message: 'Workflow name is required.',
      fieldErrors: { name: 'Required' },
    };
  }
  if (!moduleName) {
    return {
      status: 'error',
      message: 'Module / entity type is required.',
      fieldErrors: { module: 'Required' },
    };
  }
  if (steps.length === 0) {
    return {
      status: 'error',
      message: 'Add at least one step as “stepName,roleName” per line.',
      fieldErrors: { steps: 'At least one step is required' },
    };
  }

  try {
    await requireSession('/workflows');
    const definitionInput = buildDefinitionFromSteps({
      name,
      entityType: moduleName,
      description: input.description?.trim() || undefined,
      steps,
    });
    const definition = await createWorkflowDefinition(definitionInput);
    revalidatePath('/workflows');
    revalidatePath(`/workflows/definitions/${definition.id}`);
    if (input.redirectOnSuccess) {
      redirect(`/workflows/definitions/${definition.id}`);
    }
    return {
      status: 'success',
      message: 'Definition created.',
      definitionId: definition.id,
      data: { definitionId: definition.id },
    };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return toErrorState<{ definitionId: string }>(
      error,
      'Failed to create workflow definition',
    );
  }
}

export async function approveWorkflowAction(
  instanceId: string,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession('/workflows/approvals');
  const comments = String(formData.get('comments') ?? '').trim();

  try {
    await transitionWorkflowInstance(instanceId, {
      action: 'approve',
      actorId: session.user.sub,
      comments: comments || undefined,
    });
    revalidatePath('/workflows/approvals');
    revalidatePath('/workflows/instances');
    revalidatePath('/workflows');
    return { status: 'success', message: 'Approved.' };
  } catch (error) {
    return toErrorState(error, 'Failed to approve');
  }
}

export async function rejectWorkflowAction(
  instanceId: string,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession('/workflows/approvals');
  const comments = String(formData.get('comments') ?? '').trim();

  try {
    await transitionWorkflowInstance(instanceId, {
      action: 'reject',
      actorId: session.user.sub,
      comments: comments || undefined,
    });
    revalidatePath('/workflows/approvals');
    revalidatePath('/workflows/instances');
    revalidatePath('/workflows');
    return { status: 'success', message: 'Rejected.' };
  } catch (error) {
    return toErrorState(error, 'Failed to reject');
  }
}

/** Client button path: approval id maps to instance id on this backend. */
export async function decideWorkflowApprovalAction(
  approvalId: string,
  decision: 'approve' | 'reject',
): Promise<ActionState> {
  const session = await requireSession('/workflows/approvals');

  try {
    await transitionWorkflowInstance(approvalId, {
      action: decision,
      actorId: session.user.sub,
    });
    revalidatePath('/workflows/approvals');
    revalidatePath('/workflows/instances');
    revalidatePath('/workflows');
    return {
      status: 'success',
      message: decision === 'approve' ? 'Approved.' : 'Rejected.',
    };
  } catch (error) {
    return toErrorState(error, `Failed to ${decision} approval`);
  }
}

/** useFormState (FormData) + imperative client object create. */
export async function createWorkflowDefinitionAction(
  prevOrInput: ActionState<{ definitionId: string }> | null | CreateDefinitionInput,
  formData?: FormData,
): Promise<ActionState<{ definitionId: string }>> {
  if (formData instanceof FormData) {
    return createDefinitionFromParts({
      name: String(formData.get('name') ?? ''),
      module: String(formData.get('module') ?? ''),
      description: String(formData.get('description') ?? ''),
      steps: parseFormSteps(String(formData.get('steps') ?? '')),
      redirectOnSuccess: true,
    });
  }

  const input = prevOrInput as CreateDefinitionInput;
  return createDefinitionFromParts({
    name: input.name,
    module: input.module,
    description: input.description,
    steps: input.steps.map((s) => ({
      name: s.name,
      role: s.approverRole,
    })),
    redirectOnSuccess: false,
  });
}
