/**
 * Staff fee structures (Server Component).
 */
import { requireSession } from '@/lib/auth/server';
import { listFeeStructuresResult } from '@/lib/api/fees';
import { ListLoadFailure } from '@/components/route-state/list-load-failure';
import { formatCodeNameLabel } from '@/lib/entity-label';
import { loadStudentOptions } from '@/lib/load-entity-labels';
import { listGrades } from '@/lib/institutions/api';
import { listSections } from '@/lib/api/timetable';
import { StructuresWorkspace } from '../_components/structures-workspace';

export const dynamic = 'force-dynamic';

export default async function FeesStructuresPage() {
  await requireSession();
  const [structuresResult, sections, grades, studentOptions] = await Promise.all([
    listFeeStructuresResult(),
    listSections().catch(() => ({ ok: false as const, data: [] })),
    listGrades().catch(() => []),
    loadStudentOptions(),
  ]);
  const classOptions = sections.ok
    ? sections.data.map((section) => ({
        id: section.id,
        label: formatCodeNameLabel(section.code, section.name),
        searchText: `${section.code} ${section.name}`,
      }))
    : [];
  const gradeOptions = grades.map((grade) => ({
    id: grade.id,
    label: formatCodeNameLabel(grade.code, grade.name),
    searchText: `${grade.code} ${grade.name}`,
  }));
  return (
    <div className="p-6">
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
