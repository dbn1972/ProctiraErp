import { LookupLoadError } from '@/components/route-state/lookup-load-error';
import { notFound } from 'next/navigation';

import { getApplicationBundle } from '@/lib/api/admissions';
import { listInstitutionClasses } from '@/lib/api/institutions';
import { loadAdmissionsLookups } from '@/lib/admissions/lookups';
import { AdmissionsChrome } from '../_components/admissions-chrome';
import { OfferPanel } from '../_components/offer-panel';
import { PlacementPanel } from '../_components/placement-panel';
import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { hasDashboardDomainRouteAccess } from '@/lib/auth/domain-route-access';

export const dynamic = 'force-dynamic';

export default async function AdmissionApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // A-batch: check before any admissions read.
  if (!(await hasDashboardDomainRouteAccess('admissions', '/admissions'))) {
    return <RouteAccessDenied />;
  }
  const { id } = await params;
  const [bundle, lookups] = await Promise.all([getApplicationBundle(id), loadAdmissionsLookups()]);
  if (!bundle) {
    notFound();
  }

  const { application } = bundle;
  const classes = bundle.placement
    ? (
        await listInstitutionClasses(application.institutionId, bundle.placement.academicPeriodId)
      ).filter((row) => row.gradeId === bundle.placement!.gradeId)
    : [];
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {application.firstName} {application.lastName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {application.trackingNumber} · {application.status} · {application.institutionName}
        </p>
      </div>
      <LookupLoadError failed={lookups.errors} />
      <AdmissionsChrome current="/admissions">
        <div className="space-y-6">
          <PlacementPanel bundle={bundle} periods={lookups.periods} grades={lookups.grades} />
          <OfferPanel bundle={bundle} classes={classes} />
        </div>
      </AdmissionsChrome>
    </div>
  );
}
