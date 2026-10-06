'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { resourceIdSchema } from '@/lib/api/path-segment';
import { TENANT_LIFECYCLE_ACTIONS, createTenant, tenantAction } from '@/lib/api/tenants';
import { requireRole } from '@/lib/auth/server';
import { HOSTING_REGION_VALUES } from '@/lib/hosting-regions';

const createTenantSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Lowercase letters, digits, and hyphens only.'),
  contactEmail: z.string().email(),
  plan: z.enum(['pilot', 'standard', 'enterprise']),
  region: z.enum(HOSTING_REGION_VALUES, { error: 'Select a hosting region.' }),
});

/** PRC-M004: same minimum as the lifecycle dialog and the gateway. */
const TENANT_LIFECYCLE_REASON_MIN = 10;
const lifecycleSchema = z.object({
  id: resourceIdSchema,
  action: z.enum(TENANT_LIFECYCLE_ACTIONS),
  reason: z
    .string()
    .trim()
    .min(TENANT_LIFECYCLE_REASON_MIN, 'Provide at least 10 characters of justification.')
    .max(500),
});
export interface CreateTenantState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Server action: provision a new tenant. Redirects to the new tenant's
 * detail page on success; returns a structured error state otherwise.
 */
export async function createTenantAction(
  _prev: CreateTenantState,
  formData: FormData,
): Promise<CreateTenantState> {
  await requireRole('tenants');

  const raw = {
    name: formData.get('name'),
    slug: formData.get('slug'),
    contactEmail: formData.get('contactEmail'),
    plan: formData.get('plan'),
    region: formData.get('region'),
  };

  const parsed = createTenantSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string') fieldErrors[key] = issue.message;
    }
    return { error: 'Please fix the highlighted fields.', fieldErrors };
  }

  const result = await createTenant(parsed.data);
  if (!result.ok || !result.tenant) {
    return { error: result.error ?? 'Could not provision tenant.' };
  }

  revalidatePath('/tenants');
  redirect(`/tenants/${result.tenant.id}?provisioned=1`);
}

/**
 * Server action: perform a tenant lifecycle transition.
 */
export async function tenantLifecycleAction(formData: FormData): Promise<void> {
  await requireRole('tenants');

  // PRC-M001/PRC-M004: id/action become gateway path segments and the reason is an audit
  // requirement, so all three are validated here, not only by the button's disabled state.
  const parsed = lifecycleSchema.safeParse({
    id: formData.get('id'),
    action: formData.get('action'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid tenant lifecycle request.');
  }
  const { id, action, reason } = parsed.data;
  const result = await tenantAction(id, action, reason);
  // PRC-H002: surface failed writes (incl. unreachable gateway) instead of silently revalidating.
  if (!result.ok) throw new Error(result.error ?? 'Tenant action failed.');
  revalidatePath('/tenants');
  revalidatePath(`/tenants/${id}`);
}
