import type { ReactNode } from 'react';
import { RequireRoutePermission } from '@/lib/auth/route-write-guard';

/**
 * PRC-M480: staff write tool. Gated on `lms:update`, not `lms:create`: students hold
 * `lms:create` for learner submissions (PRC-M015), but only staff authoring roles
 * hold `lms:update`.
 */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRoutePermission resource="lms" action="update" returnTo="/lms/rubrics">
      {children}
    </RequireRoutePermission>
  );
}
