/**
 * Classes tab — Server Component — v2.0 redesign.
 *
 * Lists the class sections defined for an institution. A per-tab toolbar holds
 * the section count and "Add section" action; the table shows a class chip
 * (grade · section), capacity, and class-teacher / room metadata when present
 * in section customData. Sections are scoped to an academic period
 * (Requirement 5.5).
 */
import Link from 'next/link';
import { Eye, Layers } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { cn } from '@/lib/utils';
import { AddClassSectionDialog } from '@/components/institutions/academics-create-dialogs';
import {
  AssignClassSectionButton,
  ClassGradeFilter,
  ClassPeriodFilter,
} from '@/components/institutions/class-section-controls';
import { listStaff } from '@/lib/api/staff';
import { formatPersonLabel } from '@/lib/entity-label';
import {
  ApiClientError,
  listAcademicPeriods,
  listClassesByInstitution,
  listGrades,
} from '@/lib/institutions/api';
import type { AcademicPeriod, ClassSection, Grade } from '@/lib/institutions/types';

interface ClassesPageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ period?: string; grade?: string }>;
}

interface ClassesData {
  classes: ClassSection[];
  grades: Grade[];
  periods: AcademicPeriod[];
  error: string | null;
}

export default async function InstitutionClassesPage(props: ClassesPageProps) {
  const params = await props.params;
  const searchParams = (await props.searchParams) ?? {};
  const data = await loadClasses(params.id);
  const activePeriod = data.periods.find((period) => period.status === 'active') ?? data.periods[0];
  const periodParam = searchParams.period ?? activePeriod?.id ?? 'all';
  const gradeParam = searchParams.grade ?? 'senior';
  const periodScoped =
    periodParam === 'all'
      ? data.classes
      : data.classes.filter((section) => section.academicPeriodId === periodParam);
  const visibleClasses = periodScoped
    .filter((section) => {
      const grade = data.grades.find((item) => item.id === section.gradeId);
      if (gradeParam === 'all') return true;
      if (gradeParam === 'senior')
        return grade != null && ['9', '10', '11', '12'].includes(grade.code);
      return section.gradeId === gradeParam;
    })
    .slice()
    .sort((a, b) => {
      const left = data.grades.find((item) => item.id === a.gradeId);
      const right = data.grades.find((item) => item.id === b.gradeId);
      const rank = (grade: Grade | undefined) => {
        if (!grade) return 1000;
        if (grade.code === 'LKG') return -1;
        const numeric = Number(grade.code);
        return Number.isFinite(numeric) ? numeric : grade.order;
      };
      return rank(left) - rank(right) || a.name.localeCompare(b.name);
    });
  const staffOptions = await loadStaffOptions();
  const gradeMap = new Map(data.grades.map((grade) => [grade.id, grade]));

  return (
    <div className="space-y-4" data-testid="institution-classes">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground">Class sections</h2>
          <p className="text-sm text-muted-foreground">
            {data.error
              ? 'Service unavailable'
              : `${visibleClasses.length} ${visibleClasses.length === 1 ? 'section' : 'sections'} configured`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ClassPeriodFilter periods={data.periods} value={periodParam} />
          <ClassGradeFilter grades={data.grades} value={gradeParam} />
          <AddClassSectionDialog
            institutionId={params.id}
            grades={data.grades}
            periods={data.periods}
          />
        </div>
      </div>

      {/* ── Table card ── */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {data.error ? (
            <div className="px-6 py-8" role="alert">
              <p className="font-medium">Service unavailable</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {data.error}{' '}
                <Link
                  href={`/institutions/${params.id}/classes`}
                  className="font-semibold underline"
                >
                  Retry
                </Link>
              </p>
            </div>
          ) : visibleClasses.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center gap-2 py-14 text-center"
              data-testid="classes-empty"
            >
              <Layers className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-base font-semibold">No class sections yet</p>
              <p className="text-sm text-muted-foreground">
                Create the first section to start enrolling students into this institution.
              </p>
            </div>
          ) : (
            <Table aria-label="Class sections">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="font-semibold">Class</TableHead>
                  <TableHead className="font-semibold">Class teacher</TableHead>
                  <TableHead className="text-end font-semibold">Capacity</TableHead>
                  <TableHead className="font-semibold">Room</TableHead>
                  <TableHead className="text-end font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleClasses.map((section) => {
                  const grade = gradeMap.get(section.gradeId);
                  const teacher = section.classTeacherName;
                  const room = section.roomName;
                  const chip = grade ? `${grade.code} · ${section.name}` : section.name;
                  return (
                    <TableRow key={section.id} className="group">
                      <TableCell>
                        <span
                          className={cn(
                            'inline-flex min-w-[64px] items-center justify-center rounded-md',
                            'bg-primary/10 px-2.5 py-1 text-sm font-bold tracking-wide text-primary',
                          )}
                        >
                          {chip}
                        </span>
                      </TableCell>
                      <TableCell>
                        {teacher ? (
                          <div>
                            <p className="text-sm font-medium text-foreground">{teacher}</p>
                            <p className="text-[11px] text-muted-foreground">Class teacher</p>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="text-end text-sm tabular-nums text-foreground">
                        {section.capacity !== null ? section.capacity.toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{room || '—'}</TableCell>
                      <TableCell className="text-end">
                        <div className="flex items-center justify-end gap-0.5">
                          <AssignClassSectionButton
                            institutionId={params.id}
                            classId={section.id}
                            sectionLabel={chip}
                            classTeacherStaffId={section.classTeacherStaffId}
                            roomName={section.roomName}
                            staffOptions={staffOptions}
                          />
                          <Button asChild variant="ghost" size="icon" className="h-11 w-11">
                            <Link
                              href={`/students?institutionId=${params.id}&gradeId=${section.gradeId}`}
                              aria-label={`Open roster for ${chip}`}
                            >
                              <Eye className="h-4 w-4" aria-hidden="true" />
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

async function loadStaffOptions() {
  try {
    const first = await listStaff({ page: 1, pageSize: 100 });
    const people = [...first.data];
    const pages = Math.min(first.meta.totalPages, 4);
    for (let page = 2; page <= pages; page += 1) {
      const next = await listStaff({ page, pageSize: 100 });
      people.push(...next.data);
    }
    return people.map((person) => ({
      id: person.id,
      label: formatPersonLabel(person.firstName, person.lastName, person.position),
      searchText: `${person.firstName} ${person.lastName} ${person.position ?? ''}`,
    }));
  } catch {
    return [];
  }
}

async function loadClasses(institutionId: string): Promise<ClassesData> {
  try {
    const [classes, grades, periods] = await Promise.all([
      listClassesByInstitution(institutionId),
      listGrades().catch(() => [] as Grade[]),
      listAcademicPeriods().catch(() => [] as AcademicPeriod[]),
    ]);
    return { classes, grades, periods, error: null };
  } catch (error) {
    return {
      classes: [],
      grades: [],
      periods: [],
      error:
        error instanceof ApiClientError
          ? error.message
          : 'The class catalog is currently unavailable.',
    };
  }
}
