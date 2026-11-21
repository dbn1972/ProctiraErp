/**
 * A-batch (PRC-L034 pattern) — gate all `/institutions/*` dashboard routes on institution access.
 * Wraps the existing `[id]` and `new` layouts. Each page also checks before it
 * fetches (see lib/auth/domain-route-access.ts).
 */
import type { ReactNode } from 'react';
import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { canAccessDashboardDomain } from '@/lib/auth/domain-route-guards';
import { requireSession } from '@/lib/auth/server';

export default async function InstitutionsLayout({ children }: { children: ReactNode }) {
  const session = await requireSession('/institutions');
  if (!canAccessDashboardDomain(session, 'institutions')) {
    return <RouteAccessDenied />;
  }
  return children;
}
