/**
 * A-batch (PRC-L034 pattern) — gate all `/library/*` dashboard routes on library access.
 * Wraps the existing circulation/fines/overdues layouts. Each page also checks
 * before it fetches (see lib/auth/domain-route-access.ts).
 */
import type { ReactNode } from 'react';
import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { canAccessDashboardDomain } from '@/lib/auth/domain-route-guards';
import { requireSession } from '@/lib/auth/server';

export default async function LibraryLayout({ children }: { children: ReactNode }) {
  const session = await requireSession('/library');
  if (!canAccessDashboardDomain(session, 'library')) {
    return <RouteAccessDenied />;
  }
  return children;
}
