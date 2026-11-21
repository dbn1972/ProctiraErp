/**
 * A-batch (PRC-L034 pattern) — gate all `/students/*` dashboard routes on student access.
 * Each page also checks before it fetches (see lib/auth/domain-route-access.ts).
 */
import type { ReactNode } from 'react';
import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { canAccessDashboardDomain } from '@/lib/auth/domain-route-guards';
import { requireSession } from '@/lib/auth/server';

export default async function StudentsLayout({ children }: { children: ReactNode }) {
  const session = await requireSession('/students');
  if (!canAccessDashboardDomain(session, 'students')) {
    return <RouteAccessDenied />;
  }
  return children;
}
