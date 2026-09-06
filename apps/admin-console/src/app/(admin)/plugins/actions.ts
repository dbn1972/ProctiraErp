'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { pluginAction, type PluginAction } from '@/lib/api/plugins';
import { requireRole } from '@/lib/auth/server';

const decisionSchema = z.object({
  id: z.string().min(1, 'Plugin id is required.'),
  action: z.enum(['approve', 'revoke', 'disable', 'reject']),
  reason: z
    .string()
    .min(10, 'Provide at least 10 characters of justification.')
    .max(2000),
});

export interface PluginDecisionState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

export async function pluginDecisionAction(
  _prev: PluginDecisionState,
  formData: FormData,
): Promise<PluginDecisionState> {
  await requireRole('plugins');

  const parsed = decisionSchema.safeParse({
    id: formData.get('id'),
    action: formData.get('action'),
    reason: formData.get('reason'),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string') fieldErrors[key] = issue.message;
    }
    return { error: 'Please fix the highlighted fields.', fieldErrors };
  }

  const result = await pluginAction(
    parsed.data.id,
    parsed.data.action as PluginAction,
    parsed.data.reason,
  );
  if (!result.ok) {
    return { error: result.error ?? 'Decision failed.' };
  }

  revalidatePath('/plugins');
  revalidatePath(`/plugins/${parsed.data.id}`);
  return {};
}
