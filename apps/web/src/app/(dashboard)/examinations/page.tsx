/**
 * Examination definitions list (Server Component) — v2.0 redesign.
 *
 * Validates: Requirement 10.1 — examination definition browse / management.
 */
import Link from 'next/link';
import { Eye, FileText, MoreVertical, Plus, Users } from 'lucide-react';

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
import { listExaminations, type Examination } from '@/lib/api/examinations';

export const dynamic = 'force-dynamic';

const STATUS_PILL: Record<string, string> = {
  OPEN:      'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  DRAFT:     'bg-amber-50   text-amber-700   dark:bg-amber-950/40   dark:text-amber-400',
  COMPLETED: 'bg-violet-50  text-violet-700  dark:bg-violet-950/40  dark:text-violet-400',
  CLOSED:    'bg-zinc-100   text-zinc-600    dark:bg-zinc-800       dark:text-zinc-400',
  CANCELLED: 'bg-red-50     text-red-700     dark:bg-red-950/40     dark:text-red-400',
};

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  DRAFT: 'Draft',
  COMPLETED: 'Completed',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

function formatDate(d: string): string {
  const date = new Date(d);
  return Number.isNaN(date.getTime())
    ? d
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default async function ExaminationsPage() {
  const examinations = await listExaminations();

  return (
    <section aria-labelledby="examinations-heading" className="space-y-6">

      {/* ── Page head ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="examinations-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Examinations
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {examinations.length.toLocaleString()} exam{' '}
            {examinations.length === 1 ? 'cycle' : 'cycles'} · centres, candidates, and results
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/examinations/board-exports">Board export packs</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/examinations/new">
              <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
              Schedule exam
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Table card ── */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {examinations.length === 0 ? (
            <EmptyState />
          ) : (
            <Table aria-label="Examinations">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="font-semibold">Examination</TableHead>
                  <TableHead className="font-semibold">Date</TableHead>
                  <TableHead className="text-end font-semibold">Candidates</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="text-end font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {examinations.map((exam) => (
                  <TableRow key={exam.id} className="group">
                    <TableCell>
                      <Link
                        href={`/examinations/${exam.id}`}
                        className="font-semibold text-foreground hover:underline"
                      >
                        {exam.name}
                      </Link>
                      <p className="font-mono text-[11px] text-muted-foreground">{exam.code}</p>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(exam.examinationDate)}
                    </TableCell>
                    <TableCell className="text-end text-sm tabular-nums text-foreground">
                      {exam.candidateCount?.toLocaleString() ?? '—'}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
                          STATUS_PILL[exam.status] ?? 'bg-zinc-100 text-zinc-600',
                        )}
                      >
                        {STATUS_LABEL[exam.status] ?? exam.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                        <Button asChild variant="ghost" size="icon" className="h-8 w-8 p-0">
                          <Link href={`/examinations/${exam.id}`} aria-label={`View ${exam.name}`}>
                            <Eye className="h-4 w-4" aria-hidden="true" />
                          </Link>
                        </Button>
                        <Button asChild variant="ghost" size="icon" className="h-8 w-8 p-0">
                          <Link href={`/examinations/${exam.id}/candidates`} aria-label={`Candidates for ${exam.name}`}>
                            <Users className="h-4 w-4" aria-hidden="true" />
                          </Link>
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 p-0" aria-label="More actions">
                          <MoreVertical className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <FileText className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <p className="text-base font-semibold">No examinations yet</p>
      <p className="text-sm text-muted-foreground">
        Create your first examination definition to get started.
      </p>
      <Button asChild size="sm" className="mt-2">
        <Link href="/examinations/new">
          <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
          Schedule exam
        </Link>
      </Button>
    </div>
  );
}
