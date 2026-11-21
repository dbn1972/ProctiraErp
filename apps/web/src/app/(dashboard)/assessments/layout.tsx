/**
 * A-batch (PRC-L034 pattern) — gate all `/assessments/*` dashboard routes on assessment access.
 * Each page also checks before it fetches (see lib/auth/domain-route-access.ts).
 */
import type { ReactNode } from 'react';
import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { canAccessDashboardDomain } from '@/lib/auth/domain-route-guards';
import { requireSession } from '@/lib/auth/server';

export default async function AssessmentsLayout({ children }: { children: ReactNode }) {
  const session = await requireSession('/assessments');
  if (!canAccessDashboardDomain(session, 'assessments')) {
    return <RouteAccessDenied />;
  }
  return children;
}
