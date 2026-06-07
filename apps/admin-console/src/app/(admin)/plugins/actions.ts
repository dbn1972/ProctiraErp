'use server';

import { revalidatePath } from 'next/cache';

import { pluginAction, type PluginAction } from '@/lib/api/plugins';
import { requireRole } from '@/lib/auth/server';

export async function pluginDecisionAction(formData: FormData): Promise<void> {
  await requireRole('plugins');
  const id = String(formData.get('id') ?? '');
  const action = String(formData.get('action') ?? '') as PluginAction;
  const reason = String(formData.get('reason') ?? '');
  if (!id || !action) return;
  await pluginAction(id, action, reason);
  revalidatePath('/plugins');
  revalidatePath(`/plugins/${id}`);
}
