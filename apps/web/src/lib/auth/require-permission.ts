/**
 * PRC-L237 — shared server-action permission gate.
 *
 * Call at the top of a server action so callers the gateway would 403 get a
 * forbidden result without a gateway round trip. The gateway stays
 * authoritative; this is defence in depth and keeps the UI honest.
 */
import type { PermissionAction } from '@proctira/auth';
import { getSession } from '@/lib/auth/server';
import { sessionHasPermission } from './permission-guards';

export const FORBIDDEN_MESSAGE = 'You do not have permission to perform this action.';

/** True when a live session holds `resource:action`. */
export async function hasSessionPermission(
  resource: string,
  action: PermissionAction,
): Promise<boolean> {
  const session = await getSession();
  if (!session || session.isExpired) return false;
  return sessionHasPermission(session, resource, action);
}

/**
 * Returns a forbidden action state when the caller lacks the permission,
 * or `null` when the action may proceed.
 */
export async function requirePermission(
  resource: string,
  action: PermissionAction,
): Promise<{ status: 'error'; message: string } | null> {
  return (await hasSessionPermission(resource, action))
    ? null
    : { status: 'error', message: FORBIDDEN_MESSAGE };
}
