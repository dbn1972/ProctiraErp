/**
 * A-batch (PRC-L034 pattern) — gate all `/lms/*` dashboard routes on LMS access.
 * Wraps the existing bank/rubrics layouts. Each page also checks before it
 * fetches (see lib/auth/domain-route-access.ts).
 */
import type { ReactNode } from 'react';
import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { canAccessDashboardDomain } from '@/lib/auth/domain-route-guards';
import { requireSession } from '@/lib/auth/server';

export default async function LmsLayout({ children }: { children: ReactNode }) {
  const session = await requireSession('/lms');
  if (!canAccessDashboardDomain(session, 'lms')) {
    return <RouteAccessDenied />;
  }
  return children;
}
