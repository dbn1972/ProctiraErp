'use server';

import { revalidatePath } from 'next/cache';

import { updatePlanEntitlements } from '@/lib/api/plans';
import { requireRole } from '@/lib/auth/server';

/** Server action: update a plan's entitlement map. */
export async function updateEntitlementsAction(formData: FormData): Promise<void> {
  await requireRole('plans');

  const planId = String(formData.get('planId') ?? '');
  if (!planId) return;

  const entitlements: Array<{ key: string; enabled: boolean }> = [];
  formData.forEach((value, name) => {
    if (name.startsWith('entitlement.')) {
      const key = name.slice('entitlement.'.length);
      entitlements.push({ key, enabled: value === 'on' });
    }
  });

  await updatePlanEntitlements({ planId, entitlements });
  revalidatePath('/plans');
  revalidatePath(`/plans/${planId}`);
}
