/**
 * W1-SEC-02 (D5) — gate all examination dashboard routes on `examination.read`.
 */
import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { canAccessExaminationRoutes } from '@/lib/auth/examination-route-guards';
import { requireSession } from '@/lib/auth/server';

export default async function ExaminationsLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession('/examinations');

  if (!canAccessExaminationRoutes(session)) {
    return <RouteAccessDenied />;
  }

  return children;
}
