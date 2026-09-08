/**
 * Examination detail layout with hero head + tab navigation — v2.0 redesign.
 *
 * Validates: Requirement 10.1 — examination detail navigation across
 * overview, candidates, results, and documents.
 */
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileText } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import { cn } from '@/lib/utils';
import { getExamination } from '@/lib/api/examinations';

import { ExamTabs } from './exam-tabs';

interface LayoutProps {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}

const STATUS_PILL: Record<string, string> = {
  OPEN: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  DRAFT: 'bg-amber-50   text-amber-700   dark:bg-amber-950/40   dark:text-amber-400',
  COMPLETED: 'bg-violet-50  text-violet-700  dark:bg-violet-950/40  dark:text-violet-400',
  CLOSED: 'bg-zinc-100   text-zinc-600    dark:bg-zinc-800       dark:text-zinc-400',
  CANCELLED: 'bg-red-50     text-red-700     dark:bg-red-950/40     dark:text-red-400',
};

function formatDate(d: string): string {
  const date = new Date(d);
  return Number.isNaN(date.getTime())
    ? d
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default async function ExaminationDetailLayout({ params, children }: LayoutProps) {
  const { id } = await params;
  const examination = await getExamination(id);
  if (!examination) notFound();

  return (
    <section className="space-y-6">
      {/* ── Hero head ── */}
      <div className="flex flex-col gap-3">
        <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
          <Link href="/examinations">
            <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
            Back to examinations
          </Link>
        </Button>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <span
              aria-hidden="true"
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm"
            >
              <FileText className="h-7 w-7" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
                  {examination.name}
                </h1>
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
                    STATUS_PILL[examination.status] ?? 'bg-zinc-100 text-zinc-600',
                  )}
                >
                  {examination.status}
                </span>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
                <span className="font-mono">{examination.code}</span>
                <span aria-hidden="true">·</span>
                <span>{formatDate(examination.examinationDate)}</span>
              </p>
            </div>
          </div>
        </div>

        {/* ── Tabs ── */}
        <ExamTabs examId={id} candidateCount={examination.candidateCount} />
      </div>

      {children}
    </section>
  );
}
