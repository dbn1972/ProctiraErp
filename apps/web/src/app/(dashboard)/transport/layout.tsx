/**
 * T-D1 (PRC-L034 pattern) — gate all `/transport/*` dashboard routes on transport access.
 * Each page also checks before it fetches (see lib/auth/domain-route-access.ts).
 */
import type { ReactNode } from 'react';
import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { canAccessDashboardDomain } from '@/lib/auth/domain-route-guards';
import { requireSession } from '@/lib/auth/server';

export default async function TransportLayout({ children }: { children: ReactNode }) {
  const session = await requireSession('/transport');
  if (!canAccessDashboardDomain(session, 'transport')) {
    return <RouteAccessDenied />;
  }
  return children;
}
