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
    <AdmissionsChrome
      title="Merit list"
      description="Rank placed applications with configurable interview and test weights."
      current="/admissions/merit"
    >
      <MeritPanel institutions={institutions} periods={periods} grades={grades} list={list} />
    </AdmissionsChrome>
  );
}
