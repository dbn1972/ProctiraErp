'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';
import { resourceIdSchema } from '@/lib/api/path-segment';
import { THEME_ACTIONS, themeAction } from '@/lib/api/themes';
import { requireRole } from '@/lib/auth/server';

const themeDecisionSchema = z.object({
  id: resourceIdSchema,
  action: z.enum(THEME_ACTIONS),
  reason: z.string().max(2000),
});
export async function themeDecisionAction(formData: FormData): Promise<void> {
  await requireRole('themes');
  // PRC-M001: id/action become gateway path segments; validate at runtime.
  const parsed = themeDecisionSchema.safeParse({
    id: formData.get('id'),
    action: formData.get('action'),
    reason: formData.get('reason') ?? '',
  });
  if (!parsed.success) throw new Error('Invalid theme decision.');
  const { id, action, reason } = parsed.data;
  const result = await themeAction(id, action, reason);
  // PRC-H002: surface failed writes (incl. unreachable gateway) instead of silently revalidating.
  if (!result.ok) throw new Error(result.error ?? 'Theme decision failed.');
  revalidatePath('/themes');
  revalidatePath(`/themes/${id}`);
}
