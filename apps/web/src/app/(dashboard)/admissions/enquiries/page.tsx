import { LookupLoadError } from '@/components/route-state/lookup-load-error';
import { listEnquiries } from '@/lib/api/admissions';
import { loadAdmissionsLookups } from '@/lib/admissions/lookups';
import { AdmissionsChrome } from '../_components/admissions-chrome';
import { EnquiryPanel } from '../_components/enquiry-panel';
import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { hasDashboardDomainRouteAccess } from '@/lib/auth/domain-route-access';

export const dynamic = 'force-dynamic';

export default async function AdmissionsEnquiriesPage() {
  // A-batch: check before any admissions read.
  if (!(await hasDashboardDomainRouteAccess('admissions', '/admissions'))) {
    return <RouteAccessDenied />;
  }
  const [{ institutions, periods, grades, errors }, enquiries] = await Promise.all([
    loadAdmissionsLookups(),
    listEnquiries(),
  ]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Enquiries</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Capture leads, schedule follow-ups, and convert qualified prospects into applications.
        </p>
      </div>
      <LookupLoadError failed={errors} />
      <AdmissionsChrome current="/admissions/enquiries">
        <EnquiryPanel
          institutions={institutions}
          enquiries={enquiries}
          periods={periods}
          grades={grades}
        />
      </AdmissionsChrome>
    </div>
  );
}
