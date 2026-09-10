'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createTenant, tenantAction, type TenantLifecycleAction } from '@/lib/api/tenants';
import { requireRole } from '@/lib/auth/server';

const createTenantSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Lowercase letters, digits, and hyphens only.'),
  contactEmail: z.string().email(),
  plan: z.enum(['pilot', 'standard', 'enterprise']),
  region: z.string().min(2).max(60),
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

  const id = String(formData.get('id') ?? '');
  const action = String(formData.get('action') ?? '') as TenantLifecycleAction;
  const reason = String(formData.get('reason') ?? '');

  if (!id || !action) return;

  await tenantAction(id, action, reason);
  revalidatePath('/tenants');
  revalidatePath(`/tenants/${id}`);
}
