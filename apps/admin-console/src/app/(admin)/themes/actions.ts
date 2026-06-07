'use server';

import { revalidatePath } from 'next/cache';

import { themeAction } from '@/lib/api/themes';
import { requireRole } from '@/lib/auth/server';

export async function themeDecisionAction(formData: FormData): Promise<void> {
  await requireRole('themes');
  const id = String(formData.get('id') ?? '');
  const action = String(formData.get('action') ?? '') as 'approve' | 'reject';
  const reason = String(formData.get('reason') ?? '');
  if (!id || !action) return;
  await themeAction(id, action, reason);
  revalidatePath('/themes');
  revalidatePath(`/themes/${id}`);
}
