/**
 * A-batch (PRC-L034 pattern) — gate all `/academic-periods/*` dashboard routes on institution access.
 * Each page also checks before it fetches (see lib/auth/domain-route-access.ts).
 */
import type { ReactNode } from 'react';
import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { canAccessDashboardDomain } from '@/lib/auth/domain-route-guards';
import { requireSession } from '@/lib/auth/server';

export default async function AcademicPeriodsLayout({ children }: { children: ReactNode }) {
  const session = await requireSession('/academic-periods');
  if (!canAccessDashboardDomain(session, 'academic-periods')) {
    return <RouteAccessDenied />;
  }
  return children;
}
