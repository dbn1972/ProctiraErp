'use server';

/**
 * Server Actions for the tenant admin console (G-910).
 * Wrap the gateway `/tenant/*` routes; every mutation is audited server-side.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  createTenantRole,
  deleteTenantRole,
  inviteTenantUser,
  saveTenantSettings,
  setTenantUserRoles,
  setTenantUserStatus,
  updateTenantRole,
} from '@/lib/api/admin.server';
import { GatewayError } from '@/lib/api/gateway';

export interface AdminActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  fieldErrors?: Record<string, string>;
}

function flatten(fieldErrors: Record<string, string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fieldErrors)) {
    if (value?.[0]) out[key] = value[0];
  }
  return out;
}

function fail(error: unknown, fallback: string): AdminActionState {
  if (error instanceof GatewayError) {
    if (error.status === 403) {
      return { status: 'error', message: 'You need the tenant administrator role to do this.' };
    }
    return { status: 'error', message: error.message || fallback };
  }
  return { status: 'error', message: error instanceof Error ? error.message : fallback };
}

const permissionSchema = z.object({
  resource: z.string().min(1),
  action: z.enum(['create', 'read', 'update', 'delete', 'list', 'manage']),
});

const inviteSchema = z.object({
  email: z.string().email('Enter a valid e-mail address'),
  displayName: z.string().trim().min(1, 'Name is required').max(200),
  roleIds: z.array(z.string().min(1)).max(20),
});

export async function inviteUserAction(
  input: z.input<typeof inviteSchema>,
): Promise<AdminActionState> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Validation failed',
      fieldErrors: flatten(parsed.error.flatten().fieldErrors),
    };
  }
  try {
    await inviteTenantUser(parsed.data);
    revalidatePath('/admin/users');
    return { status: 'success', message: `Invited ${parsed.data.email}` };
  } catch (error) {
    return fail(error, 'Could not invite user');
  }
}

export async function setUserRolesAction(
  userId: string,
  roleIds: string[],
): Promise<AdminActionState> {
  if (!userId) return { status: 'error', message: 'Missing user' };
  try {
    await setTenantUserRoles(userId, roleIds);
    revalidatePath('/admin/users');
    return { status: 'success', message: 'Roles updated' };
  } catch (error) {
    return fail(error, 'Could not update roles');
  }
}

export async function setUserStatusAction(
  userId: string,
  status: 'ACTIVE' | 'SUSPENDED',
): Promise<AdminActionState> {
  if (!userId) return { status: 'error', message: 'Missing user' };
  try {
    await setTenantUserStatus(userId, status);
    revalidatePath('/admin/users');
    return {
      status: 'success',
      message: status === 'SUSPENDED' ? 'User suspended' : 'User reactivated',
    };
  } catch (error) {
    return fail(error, 'Could not change status');
  }
}

const roleSchema = z.object({
  name: z.string().trim().min(2, 'Role name is required').max(100),
  description: z.string().trim().max(500).optional().nullable(),
  permissions: z.array(permissionSchema).min(1, 'Grant at least one permission'),
});

export async function createRoleAction(
  input: z.input<typeof roleSchema>,
): Promise<AdminActionState> {
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Validation failed',
      fieldErrors: flatten(parsed.error.flatten().fieldErrors),
    };
  }
  try {
    await createTenantRole(parsed.data);
    revalidatePath('/admin/roles');
    revalidatePath('/admin/permissions');
    return { status: 'success', message: `Role "${parsed.data.name}" created` };
  } catch (error) {
    return fail(error, 'Could not create role');
  }
}

export async function updateRoleAction(
  id: string,
  input: z.input<typeof roleSchema>,
): Promise<AdminActionState> {
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Validation failed',
      fieldErrors: flatten(parsed.error.flatten().fieldErrors),
    };
  }
  try {
    await updateTenantRole(id, parsed.data);
    revalidatePath('/admin/roles');
    revalidatePath('/admin/permissions');
    return { status: 'success', message: 'Role updated' };
  } catch (error) {
    return fail(error, 'Could not update role');
  }
}

export async function deleteRoleAction(id: string): Promise<AdminActionState> {
  try {
    await deleteTenantRole(id);
    revalidatePath('/admin/roles');
    revalidatePath('/admin/users');
    return { status: 'success', message: 'Role deleted' };
  } catch (error) {
    return fail(error, 'Could not delete role');
  }
}

const settingsSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name is required').max(200),
  defaultLocale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Use a locale like en or en-IN'),
  supportedLocales: z.array(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/)).min(1),
  timezone: z.string().trim().min(1).max(64),
  academicYearStartMonth: z.number().int().min(1).max(12),
  branding: z.object({
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #1d4ed8'),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #0ea5e9'),
    logoUrl: z.string().url().nullable().optional(),
  }),
  contact: z.object({
    email: z.string().email().nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
  }),
});

export async function saveTenantSettingsAction(
  input: z.input<typeof settingsSchema>,
): Promise<AdminActionState> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Validation failed',
      fieldErrors: flatten(parsed.error.flatten().fieldErrors),
    };
  }
  if (!parsed.data.supportedLocales.includes(parsed.data.defaultLocale)) {
    return {
      status: 'error',
      message: 'Validation failed',
      fieldErrors: { defaultLocale: 'Default locale must be one of the supported locales' },
    };
  }
  try {
    await saveTenantSettings(parsed.data);
    revalidatePath('/admin/tenant');
    return { status: 'success', message: 'Tenant settings saved' };
  } catch (error) {
    return fail(error, 'Could not save settings');
  }
}
