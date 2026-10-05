import { getMeritList, listApplications } from '@/lib/api/admissions';
import { loadAdmissionsLookups, pickSelectedLookup } from '@/lib/admissions/lookups';
import { AdmissionsChrome } from '../_components/admissions-chrome';
import { MeritPanel } from '../_components/merit-panel';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdmissionsMeritPage(props: PageProps) {
  const searchParams = (await props.searchParams) ?? {};
  const [{ institutions, periods, grades }, applications] = await Promise.all([
    loadAdmissionsLookups(),
    listApplications(),
  ]);
  const applicationOptions = applications.map((row) => ({
    id: row.id,
    label: `${row.firstName} ${row.lastName}`.trim() || row.trackingNumber,
    searchText: `${row.firstName} ${row.lastName} ${row.trackingNumber}`,
  }));
  // PRC-M070: rank the institution/period/grade the user selected (URL), not [0].
  const institutionId = pickSelectedLookup(institutions, searchParams['institutionId']);
  const academicPeriodId = pickSelectedLookup(periods, searchParams['academicPeriodId']);
  const gradeId = pickSelectedLookup(grades, searchParams['gradeId']);
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
        <MeritPanel
          institutions={institutions}
          periods={periods}
          grades={grades}
          list={list}
          selected={{ institutionId, academicPeriodId, gradeId }}
          applications={applicationOptions}
        />
      </AdmissionsChrome>
    </div>
  );
}
