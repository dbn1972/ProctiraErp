/**
 * PRC-M480: server-side guards for staff write surfaces in the dashboard.
 *
 * `(dashboard)/layout.tsx` only requires a session, so any signed-in role
 * (including student/parent sessions) could open staff tools such as the LMS
 * question bank or library circulation desk. These guards deny the route (or hide
 * write controls) unless the session holds the permission the gateway enforces for
 * the matching write. The gateway stays authoritative.
 */
import type { ReactNode } from 'react';
import type { PermissionAction } from '@proctira/auth';
import { HealthAccessDenied } from '@/lib/auth/health-route-guards';
import { hasSessionPermission } from '@/lib/auth/require-permission';
import { requireSession } from '@/lib/auth/server';

/** True when the current session may perform `resource:action` (create/update writes). */
export async function canWrite(
  resource: string,
  action: PermissionAction = 'create',
): Promise<boolean> {
  return hasSessionPermission(resource, action);
}

/**
 * Segment-layout guard: renders an "Access denied" card (matched by the
 * route-permission-coupling e2e personas) when the session lacks the permission.
 */
export async function RequireRoutePermission({
  resource,
  action = 'create',
  returnTo,
  children,
}: {
  resource: string;
  action?: PermissionAction;
  returnTo: string;
  children: ReactNode;
}) {
  await requireSession(returnTo);
  if (!(await hasSessionPermission(resource, action))) {
    return (
      <HealthAccessDenied description="Your role is not authorized to use this staff tool. Contact your school administrator if you believe this is an error." />
    );
  }
  return <>{children}</>;
}
