import type { ReactNode } from 'react';
import { RequireRoutePermission } from '@/lib/auth/route-write-guard';

/** PRC-M480: staff write tool; requires the gateway's `lms:create` permission. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRoutePermission resource="lms" returnTo="/lms/rubrics">
      {children}
    </RequireRoutePermission>
  );
}
