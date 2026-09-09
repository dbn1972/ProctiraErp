import { notFound } from 'next/navigation';

import { getApplicationBundle } from '@/lib/api/admissions';
import { AdmissionsChrome } from '../_components/admissions-chrome';
import { OfferPanel } from '../_components/offer-panel';

export const dynamic = 'force-dynamic';

export default async function AdmissionApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const bundle = await getApplicationBundle(id);
  if (!bundle) {
    notFound();
  }

  const { application } = bundle;
  return (
    <AdmissionsChrome
      title={`${application.firstName} ${application.lastName}`}
      description={`${application.trackingNumber} · ${application.status} · ${application.institutionName}`}
      current="/admissions"
    >
      <OfferPanel bundle={bundle} />
    </AdmissionsChrome>
  );
}
