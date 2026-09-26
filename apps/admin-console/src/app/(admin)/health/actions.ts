'use server';

import { revalidatePath } from 'next/cache';

import { requireRole } from '@/lib/auth/server';

/** Reload the health snapshot from the gateway. */
export async function refreshHealthAction(): Promise<void> {
  await requireRole('health');
  revalidatePath('/health');
}
