import { listEnquiries } from '@/lib/api/admissions';
import { loadAdmissionsLookups } from '@/lib/admissions/lookups';
import { AdmissionsChrome } from '../_components/admissions-chrome';
import { EnquiryPanel } from '../_components/enquiry-panel';

export const dynamic = 'force-dynamic';

export default async function AdmissionsEnquiriesPage() {
  const [{ institutions, periods, grades }, enquiries] = await Promise.all([
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
