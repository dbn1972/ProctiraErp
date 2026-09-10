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
import { Eye } from 'lucide-react';

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
  ApiClientError,
  listAcademicPeriods,
  listClassesByInstitution,
  listGrades,
} from '@/lib/institutions/api';
import type { AcademicPeriod, ClassSection, Grade } from '@/lib/institutions/types';

interface ClassesPageProps {
  params: Promise<{ id: string }>;
}

interface ClassesData {
  classes: ClassSection[];
  grades: Grade[];
  periods: AcademicPeriod[];
  error: string | null;
}

function readStr(cd: Record<string, unknown> | null | undefined, key: string): string {
  const v = cd?.[key];
  return typeof v === 'string' ? v : '';
}

export default async function InstitutionClassesPage(props: ClassesPageProps) {
  const params = await props.params;
  const data = await loadClasses(params.id);
  const gradeMap = new Map(data.grades.map((grade) => [grade.id, grade]));

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground">Class sections</h2>
          <p className="text-sm text-muted-foreground">
            {data.error
              ? 'Service unavailable'
              : `${data.classes.length} ${data.classes.length === 1 ? 'section' : 'sections'} configured`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">{data.error}</p>
          ) : data.classes.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
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
                {data.classes.map((section) => {
                  const grade = gradeMap.get(section.gradeId);
                  const cd =
                    (section as unknown as { customData?: Record<string, unknown> }).customData ??
                    {};
                  const teacher = readStr(cd, 'classTeacher');
                  const teacherRole = readStr(cd, 'classTeacherRole');
                  const room = readStr(cd, 'room');
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
                            {teacherRole && (
                              <p className="text-[11px] text-muted-foreground">{teacherRole}</p>
                            )}
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
                        <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                          <Button asChild variant="ghost" size="icon" className="h-8 w-8 p-0">
                            <Link
                              href={`/attendance?institutionId=${params.id}&classId=${section.id}`}
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
