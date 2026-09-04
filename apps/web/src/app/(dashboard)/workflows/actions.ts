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
}

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

export async function createWorkflowDefinitionAction(
  _prev: ActionState<{ definitionId: string }> | null,
  formData: FormData,
): Promise<ActionState<{ definitionId: string }>> {
  const name = String(formData.get('name') ?? '').trim();
  const module = String(formData.get('module') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const stepsRaw = String(formData.get('steps') ?? '');

  if (!name) {
    return {
      status: 'error',
      message: 'Workflow name is required.',
      fieldErrors: { name: 'Required' },
    };
  }
  if (!module) {
    return {
      status: 'error',
      message: 'Module / entity type is required.',
      fieldErrors: { module: 'Required' },
    };
  }

  const steps = stepsRaw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [stepName, role] = line.split(',').map((p) => p.trim());
      return { name: stepName ?? '', role: role ?? '' };
    })
    .filter((s) => s.name && s.role);

  if (steps.length === 0) {
    return {
      status: 'error',
      message: 'Add at least one step as “stepName,roleName” per line.',
      fieldErrors: { steps: 'At least one step is required' },
    };
  }

  try {
    const input = buildDefinitionFromSteps({
      name,
      entityType: module,
      description: description || undefined,
      steps,
    });
    const definition = await createWorkflowDefinition(input);
    revalidatePath('/workflows');
    redirect(`/workflows/definitions/${definition.id}`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return toErrorState<{ definitionId: string }>(
      error,
      'Failed to create workflow definition',
    );
  }
}
