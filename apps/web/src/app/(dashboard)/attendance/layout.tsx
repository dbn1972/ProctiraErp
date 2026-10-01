/**
 * PRC-L034 — gate all `/attendance/*` dashboard routes on the domain read permission.
 */
import type { ReactNode } from 'react';

import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { canAccessDashboardDomain } from '@/lib/auth/domain-route-guards';
import { requireSession } from '@/lib/auth/server';

export default async function AttendanceLayout({ children }: { children: ReactNode }) {
  const session = await requireSession('/attendance');
  if (!canAccessDashboardDomain(session, 'attendance')) {
    return <RouteAccessDenied />;
  }
  return children;
}
