'use server';

import { revalidatePath } from 'next/cache';

import { updatePlanEntitlements } from '@/lib/api/plans';
import { resourceIdSchema } from '@/lib/api/path-segment';
import { requireRole } from '@/lib/auth/server';

const ENTITLEMENT_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** Server action: update a plan's entitlement map. */
export async function updateEntitlementsAction(formData: FormData): Promise<void> {
  await requireRole('plans');

  // PRC-M001: planId becomes a gateway path segment; entitlement keys are catalogue slugs.
  const parsedId = resourceIdSchema.safeParse(formData.get('planId'));
  if (!parsedId.success) throw new Error('Invalid plan id.');
  const planId = parsedId.data;

  const entitlements: Array<{ key: string; enabled: boolean }> = [];
  formData.forEach((value, name) => {
    if (name.startsWith('entitlement.')) {
      const key = name.slice('entitlement.'.length);
      if (!ENTITLEMENT_KEY_PATTERN.test(key)) throw new Error('Invalid entitlement key.');
      entitlements.push({ key, enabled: value === 'on' });
    }
  });

  const result = await updatePlanEntitlements({ planId, entitlements });
  // PRC-H002: surface failed writes (incl. unreachable gateway) instead of silently revalidating.
  if (!result.ok) throw new Error(result.error ?? 'Failed to update entitlements.');
  revalidatePath('/plans');
  revalidatePath(`/plans/${planId}`);
}
