import type { ReactNode } from 'react';
import { RequireRoutePermission } from '@/lib/auth/route-write-guard';

/** PRC-M480: staff write tool; requires the gateway's `library:create` permission. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRoutePermission resource="library" returnTo="/library/circulation">
      {children}
    </RequireRoutePermission>
  );
}
