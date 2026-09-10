/**
 * Grades tab — Server Component — v2.0 redesign.
 *
 * Lists the education grade levels offered, enriched with REAL per-grade
 * section counts and summed seat capacity computed from this institution's
 * class sections. Utilization shows only when both capacity and enrollment
 * are known (enrollment is read from grade customData when present).
 */

import Link from 'next/link';

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
import { AddGradeDialog } from '@/components/institutions/academics-create-dialogs';
import { ApiClientError, listClassesByInstitution, listGrades } from '@/lib/institutions/api';
import type { ClassSection, Grade } from '@/lib/institutions/types';

interface GradesPageProps {
  params: Promise<{ id: string }>;
}

interface GradesData {
  grades: Grade[];
  classes: ClassSection[];
  error: string | null;
}

function readNum(cd: Record<string, unknown> | null | undefined, key: string): number | null {
  const v = cd?.[key];
  return typeof v === 'number' ? v : null;
}

function UtilizationBar({ pct }: { pct: number }) {
  const cls = pct >= 95 ? 'bg-amber-500' : pct >= 100 ? 'bg-red-500' : 'bg-emerald-500';
  const textCls =
    pct >= 95 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400';
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', cls)}
          style={{ width: `${Math.min(100, pct)}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Utilization ${pct}%`}
        />
      </div>
      <span className={cn('text-xs font-bold tabular-nums', textCls)}>{pct}%</span>
    </div>
  );
}

export default async function InstitutionGradesPage(props: GradesPageProps) {
  const params = await props.params;
  const data = await loadGrades(params.id);

  // Compute real per-grade section count + summed capacity.
  const byGrade = new Map<string, { sections: number; capacity: number }>();
  for (const section of data.classes) {
    const entry = byGrade.get(section.gradeId) ?? { sections: 0, capacity: 0 };
    entry.sections += 1;
    entry.capacity += section.capacity ?? 0;
    byGrade.set(section.gradeId, entry);
  }

  // Grades are a tenant-wide catalog; a grade added here must stay visible even
  // before its first section exists, so list them all and let the Sections
  // column show which ones are offered at this institution.
  const offered = data.grades;
  const offeredCount = offered.filter((g) => byGrade.has(g.id)).length;

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground">Grades offered</h2>
          <p className="text-sm text-muted-foreground">
            {data.error
              ? 'Catalog unavailable'
              : `${offered.length} ${offered.length === 1 ? 'grade' : 'grades'} · ${offeredCount} with sections here`}
          </p>
        </div>
        <AddGradeDialog />
      </div>

      {/* ── Table card ── */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {data.error ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">{data.error}</p>
          ) : offered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
              <p className="text-base font-semibold">No grades defined</p>
              <p className="text-sm text-muted-foreground">
                Add grades to begin configuring sections for this institution.
              </p>
            </div>
          ) : (
            <Table aria-label="Grades">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="font-semibold">Grade</TableHead>
                  <TableHead className="text-end font-semibold">Sections</TableHead>
                  <TableHead className="text-end font-semibold">Capacity</TableHead>
                  <TableHead className="font-semibold">Utilization</TableHead>
                  <TableHead className="text-end font-semibold">Sections</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {offered
                  .slice()
                  .sort(
                    (a, b) =>
                      Number(byGrade.has(b.id)) - Number(byGrade.has(a.id)) || a.order - b.order,
                  )
                  .map((grade) => {
                    const agg = byGrade.get(grade.id) ?? { sections: 0, capacity: 0 };
                    const cd =
                      (grade as unknown as { customData?: Record<string, unknown> }).customData ??
                      {};
                    const enrollment = readNum(cd, 'enrollment');
                    const utilization =
                      enrollment !== null && agg.capacity > 0
                        ? Math.round((enrollment / agg.capacity) * 100)
                        : null;
                    return (
                      <TableRow key={grade.id} className="group">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <span
                              aria-hidden="true"
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-base font-extrabold tracking-wide text-primary"
                            >
                              {grade.code}
                            </span>
                            <div>
                              <p className="text-sm font-semibold text-foreground">{grade.name}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {agg.sections > 0
                                  ? `${agg.sections} ${agg.sections === 1 ? 'section' : 'sections'}`
                                  : 'No sections yet'}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-end text-sm tabular-nums text-foreground">
                          {agg.sections}
                        </TableCell>
                        <TableCell className="text-end text-sm tabular-nums text-foreground">
                          {agg.capacity > 0 ? agg.capacity.toLocaleString() : '—'}
                        </TableCell>
                        <TableCell>
                          {utilization !== null ? (
                            <UtilizationBar pct={utilization} />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-end">
                          <Button asChild variant="ghost" size="sm">
                            <Link
                              href={`/institutions/${params.id}/classes`}
                              aria-label={`View sections for ${grade.name}`}
                            >
                              {agg.sections} {agg.sections === 1 ? 'section' : 'sections'}
                            </Link>
                          </Button>
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

async function loadGrades(institutionId: string): Promise<GradesData> {
  try {
    const [grades, classes] = await Promise.all([
      listGrades(),
      listClassesByInstitution(institutionId).catch(() => [] as ClassSection[]),
    ]);
    return { grades, classes, error: null };
  } catch (error) {
    return {
      grades: [],
      classes: [],
      error:
        error instanceof ApiClientError
          ? error.message
          : 'The grade catalog is currently unavailable.',
    };
  }
}
