import type { ReactNode } from 'react';
import { RequireRoutePermission } from '@/lib/auth/route-write-guard';

/** PRC-M480: registering an institution requires the gateway's `institution:create`. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRoutePermission resource="institution" returnTo="/institutions/new">
      {children}
    </RequireRoutePermission>
  );
}
