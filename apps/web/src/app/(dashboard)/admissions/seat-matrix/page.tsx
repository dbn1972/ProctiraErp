import { listSeatMatrix } from '@/lib/api/admissions';
import { loadAdmissionsLookups } from '@/lib/admissions/lookups';
import { AdmissionsChrome } from '../_components/admissions-chrome';
import { SeatMatrixPanel } from '../_components/seat-matrix-panel';

export const dynamic = 'force-dynamic';

export default async function AdmissionsSeatMatrixPage() {
  const { institutions, periods, grades } = await loadAdmissionsLookups();
  const rows = await listSeatMatrix(
    institutions[0]?.id ? { institutionId: institutions[0].id } : undefined,
  );

  return (
    <AdmissionsChrome
      title="Seat matrix"
      description="Quota seats per institution, academic period, and grade. Filled counts come from accepted offers."
      current="/admissions/seat-matrix"
    >
      <SeatMatrixPanel
        institutions={institutions}
        periods={periods}
        grades={grades}
        rows={rows}
      />
    </AdmissionsChrome>
  );
}
