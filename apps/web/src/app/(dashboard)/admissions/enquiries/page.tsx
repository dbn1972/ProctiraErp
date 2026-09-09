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
    <AdmissionsChrome
      title="Enquiries"
      description="Capture leads, schedule follow-ups, and convert qualified prospects into applications."
      current="/admissions/enquiries"
    >
      <EnquiryPanel
        institutions={institutions}
        enquiries={enquiries}
        periods={periods}
        grades={grades}
      />
    </AdmissionsChrome>
  );
}
