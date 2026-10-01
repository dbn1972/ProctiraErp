/**
 * PRC-L034 — gate all `/billing/*` dashboard routes on the domain read permission.
 */
import type { ReactNode } from 'react';

import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { canAccessDashboardDomain } from '@/lib/auth/domain-route-guards';
import { requireSession } from '@/lib/auth/server';

export default async function BillingLayout({ children }: { children: ReactNode }) {
  const session = await requireSession('/billing');
  if (!canAccessDashboardDomain(session, 'billing')) {
    return <RouteAccessDenied />;
  }
  return children;
}
