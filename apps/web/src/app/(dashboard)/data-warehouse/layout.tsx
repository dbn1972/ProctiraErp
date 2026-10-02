/**
 * PRC-L034 — gate all `/data-warehouse/*` dashboard routes on the domain read permission.
 */
import type { ReactNode } from 'react';

import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { canAccessDashboardDomain } from '@/lib/auth/domain-route-guards';
import { requireSession } from '@/lib/auth/server';

export default async function DataWarehouseLayout({ children }: { children: ReactNode }) {
  const session = await requireSession('/data-warehouse');
  if (!canAccessDashboardDomain(session, 'data-warehouse')) {
    return <RouteAccessDenied />;
  }
  return children;
}
