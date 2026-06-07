'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
  createBreakGlassRequest,
  decideBreakGlassRequest,
} from '@/lib/api/break-glass';
import {
  BREAK_GLASS_MAX_MINUTES,
  BREAK_GLASS_USE_CASES,
} from '@/lib/api/break-glass-constants';
import { requireRole } from '@/lib/auth/server';

const createSchema = z.object({
  targetTenantId: z.string().min(1, 'Target tenant is required.'),
  scope: z.enum(['read', 'support', 'admin']),
  useCase: z.enum(BREAK_GLASS_USE_CASES),
  justification: z
    .string()
    .min(20, 'Provide at least 20 characters of justification.')
    .max(2000),
  durationMinutes: z
    .number()
    .int()
    .min(15, 'Minimum duration is 15 minutes.')
    .max(BREAK_GLASS_MAX_MINUTES, `Maximum is ${BREAK_GLASS_MAX_MINUTES} minutes.`),
});

export interface CreateBreakGlassState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

export async function createBreakGlassAction(
  _prev: CreateBreakGlassState,
  formData: FormData,
): Promise<CreateBreakGlassState> {
  await requireRole('breakGlassRequest');

  const raw = {
    targetTenantId: formData.get('targetTenantId'),
    scope: formData.get('scope'),
    useCase: formData.get('useCase'),
    justification: formData.get('justification'),
    durationMinutes: Number(formData.get('durationMinutes') ?? 60),
  };

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string') fieldErrors[key] = issue.message;
    }
    return { error: 'Please fix the highlighted fields.', fieldErrors };
  }

  const result = await createBreakGlassRequest(parsed.data);
  if (!result.ok || !result.request) {
    return { error: result.error ?? 'Could not submit request.' };
  }

  revalidatePath('/break-glass/requests');
  redirect(`/break-glass/requests?submitted=${result.request.id}`);
}

export async function breakGlassDecisionAction(formData: FormData): Promise<void> {
  await requireRole('breakGlassApprove');
  const id = String(formData.get('id') ?? '');
  const decision = String(formData.get('decision') ?? '') as
    | 'approve'
    | 'deny'
    | 'revoke';
  const reason = String(formData.get('reason') ?? '');
  if (!id || !decision) return;
  await decideBreakGlassRequest(id, decision, reason);
  revalidatePath('/break-glass/requests');
}
