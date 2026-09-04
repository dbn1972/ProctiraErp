/**
 * Grades tab — Server Component — v2.0 redesign.
 *
 * Lists the education grade levels offered, enriched with REAL per-grade
 * section counts and summed seat capacity computed from this institution's
 * class sections. Utilization shows only when both capacity and enrollment
 * are known (enrollment is read from grade customData when present).
 */
import { MoreVertical, Pencil } from 'lucide-react';

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
import { AddGradeButton } from '@/components/institutions/add-grade-button';
import { cn } from '@/lib/utils';
import {
  ApiClientError,
  listClassesByInstitution,
  listGrades,
} from '@/lib/institutions/api';
import type { ClassSection, Grade } from '@/lib/institutions/types';

interface GradesPageProps {
  params: { id: string };
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
  const cls =
    pct >= 95 ? 'bg-amber-500' :
    pct >= 100 ? 'bg-red-500'  :
                 'bg-emerald-500';
  const textCls =
    pct >= 95 ? 'text-amber-700 dark:text-amber-400' :
                'text-emerald-700 dark:text-emerald-400';
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

export default async function InstitutionGradesPage({ params }: GradesPageProps) {
  const data = await loadGrades(params.id);

  // Compute real per-grade section count + summed capacity.
  const byGrade = new Map<string, { sections: number; capacity: number }>();
  for (const section of data.classes) {
    const entry = byGrade.get(section.gradeId) ?? { sections: 0, capacity: 0 };
    entry.sections += 1;
    entry.capacity += section.capacity ?? 0;
    byGrade.set(section.gradeId, entry);
  }

  // Only show grades that are offered here (have ≥1 section), falling back to
  // the full catalog when no sections are configured yet.
  const offered = data.classes.length > 0
    ? data.grades.filter((g) => byGrade.has(g.id))
    : data.grades;

  const nextOrder =
    data.grades.reduce((max, g) => Math.max(max, g.order), -1) + 1;

  return (
    <div className="space-y-4">

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground">Grades offered</h2>
          <p className="text-sm text-muted-foreground">
            {data.error
              ? 'Catalog unavailable'
              : `${offered.length} ${offered.length === 1 ? 'grade' : 'grades'} · section capacity per grade`}
          </p>
        </div>
        <AddGradeButton institutionId={params.id} nextOrder={nextOrder} />
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
                  <TableHead className="text-end font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {offered
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((grade) => {
                    const agg = byGrade.get(grade.id) ?? { sections: 0, capacity: 0 };
                    const cd = (grade as unknown as { customData?: Record<string, unknown> }).customData ?? {};
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
                          <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                            <Button variant="ghost" size="icon" className="h-8 w-8 p-0" aria-label={`Edit ${grade.name}`}>
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 p-0" aria-label="More actions">
                              <MoreVertical className="h-4 w-4" aria-hidden="true" />
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
