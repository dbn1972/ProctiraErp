/**
 * Examination overview tab — v2.0 redesign.
 *
 * Validates: Requirement 10.1 — examination definition summary.
 */
import { notFound } from 'next/navigation';
import { CalendarDays, CheckCircle2, Users } from 'lucide-react';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { cn } from '@/lib/utils';
import { getExamination } from '@/lib/api/examinations';

interface PageProps {
  params: { id: string };
}

function formatDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const date = new Date(d);
  return Number.isNaN(date.getTime())
    ? d
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function KpiCard({
  icon: Icon,
  iconBg,
  label,
  value,
  foot,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  label: string;
  value: React.ReactNode;
  foot?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <span aria-hidden="true" className={cn('flex h-9 w-9 items-center justify-center rounded-lg', iconBg)}>
            <Icon className="h-5 w-5" />
          </span>
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
        </div>
        <p className="text-2xl font-extrabold tracking-tight text-foreground">{value}</p>
        {foot && <p className="mt-1 text-xs text-muted-foreground">{foot}</p>}
      </CardContent>
    </Card>
  );
}

function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2 border-b border-border/60 py-2.5 last:border-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

export default async function ExaminationOverviewPage({ params }: PageProps) {
  const exam = await getExamination(params.id);
  if (!exam) notFound();

  const regStart = formatDate(exam.registrationStartDate);
  const regEnd = formatDate(exam.registrationEndDate);

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          icon={Users}
          iconBg="bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
          label="Candidates"
          value={exam.candidateCount?.toLocaleString() ?? 'Currently unavailable'}
        />
        <KpiCard
          icon={CalendarDays}
          iconBg="bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400"
          label="Exam date"
          value={formatDate(exam.examinationDate) ?? '—'}
        />
        <KpiCard
          icon={CheckCircle2}
          iconBg="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
          label="Results"
          value={exam.resultsPublished ? 'Published' : 'Pending'}
        />
      </div>

      {/* Facts */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Examination details</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <dl>
            <FactRow label="Name">{exam.name}</FactRow>
            <FactRow label="Code"><span className="font-mono">{exam.code}</span></FactRow>
            <FactRow label="Examination date">{formatDate(exam.examinationDate) ?? '—'}</FactRow>
            <FactRow label="Registration window">
              {regStart && regEnd ? `${regStart} → ${regEnd}` : 'Not set'}
            </FactRow>
            <FactRow label="Status">{exam.status}</FactRow>
            <FactRow label="Candidates">
              {exam.candidateCount?.toLocaleString() ?? 'Currently unavailable'}
            </FactRow>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
