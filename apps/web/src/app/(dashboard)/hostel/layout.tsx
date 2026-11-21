/**
 * H-D1 (PRC-L034 pattern) — gate all `/hostel/*` dashboard routes on hostel access.
 * Each page also checks before it fetches (see lib/auth/domain-route-access.ts).
 */
import type { ReactNode } from 'react';
import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { canAccessDashboardDomain } from '@/lib/auth/domain-route-guards';
import { requireSession } from '@/lib/auth/server';

export default async function HostelLayout({ children }: { children: ReactNode }) {
  const session = await requireSession('/hostel');
  if (!canAccessDashboardDomain(session, 'hostel')) {
    return <RouteAccessDenied />;
  }
  return children;
}
