/**
 * Institution curriculum — syllabus units, lesson plans, coverage (G-923).
 *
 * Route: /institutions/[id]/curriculum
 */
import { Card, CardContent } from '@proctira/ui/components';
import { CurriculumPanel } from '@/components/institutions/curriculum-panel';
import {
  getCurriculumCoverage,
  listLearningOutcomes,
  listLessonPlans,
  listSyllabusUnits,
  type LessonPlan,
} from '@/lib/api/curriculum';
import { listAcademicPeriods, listGrades, listSubjects, type SubjectSummary } from '@/lib/institutions/api';
import type { AcademicPeriod, Grade } from '@/lib/institutions/types';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ subjectId?: string; gradeId?: string; academicPeriodId?: string }>;
}

export default async function InstitutionCurriculumPage(props: PageProps) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const institutionId = params.id;

  const [subjects, grades, periods] = await Promise.all([
    listSubjects().catch(() => [] as SubjectSummary[]),
    listGrades().catch(() => [] as Grade[]),
    listAcademicPeriods().catch(() => [] as AcademicPeriod[]),
  ]);

  const subjectId =
    searchParams?.subjectId && subjects.some((s) => s.id === searchParams.subjectId)
      ? searchParams.subjectId
      : (subjects[0]?.id ?? '');
  const gradeId =
    searchParams?.gradeId && grades.some((g) => g.id === searchParams.gradeId)
      ? searchParams.gradeId
      : (grades[0]?.id ?? '');
  const academicPeriodId =
    searchParams?.academicPeriodId && periods.some((p) => p.id === searchParams.academicPeriodId)
      ? searchParams.academicPeriodId
      : (periods[0]?.id ?? '');

  const unitsResult =
    subjectId && gradeId && academicPeriodId
      ? await listSyllabusUnits({
          institutionId,
          subjectId,
          gradeId,
          academicPeriodId,
        })
      : { ok: true as const, data: [] };
  const units = unitsResult.ok ? unitsResult.data : [];
  const loadError = unitsResult.ok ? null : unitsResult.error;

  const plansByUnit: Record<string, LessonPlan[]> = {};
  for (const unit of units) {
    const plans = await listLessonPlans(unit.id);
    plansByUnit[unit.id] = plans.ok ? plans.data : [];
  }

  const outcomesResult = subjectId
    ? await listLearningOutcomes({ subjectId, gradeId: gradeId || undefined })
    : { ok: true as const, data: [] };
  const outcomes = outcomesResult.ok ? outcomesResult.data : [];

  const coverageResult =
    subjectId && gradeId && academicPeriodId
      ? await getCurriculumCoverage({
          subjectId,
          gradeId,
          academicPeriodId,
          institutionId,
        })
      : { ok: true as const, data: null };
  const coverage = coverageResult.ok ? coverageResult.data : null;
  const coverageRows = (coverage?.taughtUnitIds ?? []).map((unitId) => ({
    unitId,
    taughtAt: 'taught',
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-foreground">Curriculum</h2>
        <p className="text-sm text-muted-foreground">
          Syllabus units and lesson plans per subject × grade × period. Mark units taught to update
          coverage.
        </p>
      </div>
      {loadError ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-semibold">Curriculum API unavailable</p>
            <p className="text-sm text-muted-foreground" role="alert">
              {loadError}
            </p>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardContent className="p-6">
          <CurriculumPanel
            institutionId={institutionId}
            subjects={subjects}
            grades={grades}
            periods={periods}
            units={units}
            plansByUnit={plansByUnit}
            outcomes={outcomes}
            coverage={coverage}
            coverageRows={coverageRows}
            defaultSubjectId={subjectId}
            defaultGradeId={gradeId}
            defaultPeriodId={academicPeriodId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
