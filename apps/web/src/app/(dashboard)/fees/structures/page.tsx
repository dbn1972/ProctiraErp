/**
 * Staff fee structures (Server Component).
 */
import { requireSession } from '@/lib/auth/server';
import { listFeeStructuresResult } from '@/lib/api/fees';
import { ListLoadFailure } from '@/components/route-state/list-load-failure';
import { formatCodeNameLabel } from '@/lib/entity-label';
import { loadStudentOptions } from '@/lib/load-entity-labels';
import { listGrades, listClassesByInstitution } from '@/lib/institutions/api';
import { listInstitutions } from '@/lib/api/institutions';
import { MAX_API_PAGE_SIZE } from '@/lib/api/pagination';
import { StructuresWorkspace } from '../_components/structures-workspace';

export const dynamic = 'force-dynamic';

export default async function FeesStructuresPage() {
  await requireSession();
  const [structuresResult, institutions, grades, studentOptions] = await Promise.all([
    listFeeStructuresResult(),
    listInstitutions({ pageSize: MAX_API_PAGE_SIZE }).catch(() => []),
    listGrades().catch(() => []),
    loadStudentOptions(),
  ]);
  // PRC-M087: invoices and enrolments key on the classes table, not timetable
  // sections, so the class picker must offer classes.
  const classGroups = await Promise.all(
    institutions.map(async (institution) =>
      (await listClassesByInstitution(institution.id).catch(() => [])).map((row) => ({
        id: row.id,
        label:
          institutions.length > 1
            ? `${formatCodeNameLabel(institution.code, institution.name)} · ${row.name}`
            : row.name,
        searchText: `${institution.name} ${row.name}`,
      })),
    ),
  );
  const classOptions = classGroups.flat();
  const gradeOptions = grades.map((grade) => ({
    id: grade.id,
    label: formatCodeNameLabel(grade.code, grade.name),
    searchText: `${grade.code} ${grade.name}`,
  }));
  return (
    <div className="space-y-6 p-6">
      <StructuresWorkspace
        structures={structuresResult.ok ? structuresResult.items : []}
        listFailed={!structuresResult.ok}
        failure={
          structuresResult.ok ? null : (
            <ListLoadFailure
              kind={structuresResult.kind}
              status={structuresResult.status}
              returnTo="/fees/structures"
            />
          )
        }
        classOptions={classOptions}
        gradeOptions={gradeOptions}
        studentOptions={studentOptions}
        header={
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Fee structures
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Class × category × term amounts, instalment schedules, and bulk invoicing.
            </p>
          </div>
        }
      />
    </div>
  );
}
