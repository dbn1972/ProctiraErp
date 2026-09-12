import { getMeritList } from '@/lib/api/admissions';
import { loadAdmissionsLookups } from '@/lib/admissions/lookups';
import { AdmissionsChrome } from '../_components/admissions-chrome';
import { MeritPanel } from '../_components/merit-panel';

export const dynamic = 'force-dynamic';

export default async function AdmissionsMeritPage() {
  const { institutions, periods, grades } = await loadAdmissionsLookups();
  const institutionId = institutions[0]?.id;
  const academicPeriodId = periods[0]?.id;
  const gradeId = grades[0]?.id;
  const list =
    institutionId && academicPeriodId && gradeId
      ? await getMeritList({ institutionId, academicPeriodId, gradeId })
      : null;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Merit list</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ingest interview and entrance/test scores on placement, then rank with configurable
          weights.
        </p>
      </div>
      <AdmissionsChrome current="/admissions/merit">
        <MeritPanel institutions={institutions} periods={periods} grades={grades} list={list} />
      </AdmissionsChrome>
    </div>
  );
}
