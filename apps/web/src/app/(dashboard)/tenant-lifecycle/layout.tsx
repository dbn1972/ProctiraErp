/**
 * A-batch (PRC-L034 pattern) — gate `/tenant-lifecycle` on platform access.
 * The page also checks before it fetches (see lib/auth/domain-route-access.ts).
 */
import type { ReactNode } from 'react';
import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { canAccessDashboardDomain } from '@/lib/auth/domain-route-guards';
import { requireSession } from '@/lib/auth/server';

export default async function TenantLifecycleLayout({ children }: { children: ReactNode }) {
  const session = await requireSession('/tenant-lifecycle');
  if (!canAccessDashboardDomain(session, 'tenant-lifecycle')) {
    return <RouteAccessDenied />;
  }
  return children;
}
