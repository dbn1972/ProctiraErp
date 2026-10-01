/**
 * PRC-L034 — gate all `/audit-logs/*` dashboard routes on the domain read permission.
 */
import type { ReactNode } from 'react';

import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { canAccessDashboardDomain } from '@/lib/auth/domain-route-guards';
import { requireSession } from '@/lib/auth/server';

export default async function AuditLogsLayout({ children }: { children: ReactNode }) {
  const session = await requireSession('/audit-logs');
  if (!canAccessDashboardDomain(session, 'audit-logs')) {
    return <RouteAccessDenied />;
  }
  return children;
}
