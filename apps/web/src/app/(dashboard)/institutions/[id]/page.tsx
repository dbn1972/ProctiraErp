import { redirect } from 'next/navigation';
import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { hasDashboardDomainRouteAccess } from '@/lib/auth/domain-route-access';

interface InstitutionPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Fallback when a request reaches this segment without middleware.
 * The authoritative hop is `institutionBareDetailRedirect` in middleware,
 * which 307s to `/overview` before this layout fetches the institution.
 * A `redirect()` here still waits on that layout, so it is not the primary path.
 */
export default async function InstitutionPage(props: InstitutionPageProps) {
  // A-batch: check before any institution read.
  if (!(await hasDashboardDomainRouteAccess('institutions', '/institutions'))) {
    return <RouteAccessDenied />;
  }
  const params = await props.params;
  redirect(`/institutions/${params.id}/overview`);
}
