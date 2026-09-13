/**
 * W1-SEC-02 (D2) — centralized PHI-aware deny for all `/health/*` App Router pages.
 */
import type { ReactNode } from 'react';

import { canAccessHealthRecords } from '@/lib/api/health';
import { HealthAccessDenied } from '@/lib/auth/health-route-guards';
import { requireSession } from '@/lib/auth/server';

export default async function HealthLayout({ children }: { children: ReactNode }) {
  const session = await requireSession('/health');

  if (!canAccessHealthRecords(session.user.roles ?? [])) {
    return (
      <HealthAccessDenied description="Your role is not authorized to access health records. Contact your school health officer if you believe this is an error." />
    );
  }

  return children;
}
