import { notFound } from 'next/navigation';

import { getApplicationBundle } from '@/lib/api/admissions';
import { loadAdmissionsLookups } from '@/lib/admissions/lookups';
import { AdmissionsChrome } from '../_components/admissions-chrome';
import { OfferPanel } from '../_components/offer-panel';
import { PlacementPanel } from '../_components/placement-panel';

export const dynamic = 'force-dynamic';

export default async function AdmissionApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [bundle, lookups] = await Promise.all([getApplicationBundle(id), loadAdmissionsLookups()]);
  if (!bundle) {
    notFound();
  }

  const { application } = bundle;
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
      <AdmissionsChrome current="/admissions">
        <div className="space-y-6">
          <PlacementPanel bundle={bundle} periods={lookups.periods} grades={lookups.grades} />
          <OfferPanel bundle={bundle} />
        </div>
      </AdmissionsChrome>
    </div>
  );
}
