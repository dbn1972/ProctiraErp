/**
 * Scholarship program detail page.
 *
 * Validates: Requirement 11.1 — view scholarship program detail and quick
 * navigation to applications.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, FileText, Pencil, Users, Wallet } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { getScholarshipProgram, type ScholarshipProgram } from '@/lib/api/scholarships';
import { cn } from '@/lib/utils';

interface PageProps {
  params: { id: string };
}

const STATUS_LABELS: Record<ScholarshipProgram['status'], string> = {
  DRAFT: 'Draft',
  OPEN: 'Window open',
  CLOSED: 'Closed',
  ARCHIVED: 'Archived',
};

const STATUS_COLOURS: Record<ScholarshipProgram['status'], string> = {
  OPEN: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  DRAFT: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  CLOSED: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  ARCHIVED: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
};

export default async function ScholarshipProgramPage({ params }: PageProps) {
  const program = await getScholarshipProgram(params.id);
  if (!program) notFound();

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/scholarships">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to programs
        </Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
            {program.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-mono">{program.code}</span> · {program.currency}{' '}
            {program.awardAmount.toLocaleString()} per student ·{' '}
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold align-middle',
                STATUS_COLOURS[program.status],
              )}
            >
              {STATUS_LABELS[program.status]}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/scholarships/applications?programId=${program.id}`}>
              <FileText className="me-1.5 h-4 w-4" aria-hidden="true" />
              View applications
            </Link>
          </Button>
          <Button size="sm">
            <Pencil className="me-1.5 h-4 w-4" aria-hidden="true" />
            Edit program
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard
              icon={<Users className="h-5 w-5" aria-hidden="true" />}
              label="Total slots"
              value={program.totalSlots.toLocaleString()}
            />
            <KpiCard
              icon={<Wallet className="h-5 w-5" aria-hidden="true" />}
              label="Award amount"
              value={`${program.currency} ${program.awardAmount.toLocaleString()}`}
            />
            <KpiCard
              icon={<FileText className="h-5 w-5" aria-hidden="true" />}
              label="Status"
              value={STATUS_LABELS[program.status]}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Applications</CardTitle>
              <CardDescription>Review applications submitted to this program.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href={`/scholarships/applications?programId=${program.id}`}>
                  View applications
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Program facts</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="text-sm">
                <FactRow label="Code" value={program.code} mono />
                <FactRow
                  label="Award"
                  value={`${program.currency} ${program.awardAmount.toLocaleString()} / yr`}
                />
                <FactRow label="Total slots" value={program.totalSlots.toLocaleString()} />
                <FactRow label="Application opens" value={program.applicationStartDate} />
                <FactRow label="Application closes" value={program.applicationEndDate} />
                <FactRow label="Status" value={STATUS_LABELS[program.status]} />
              </dl>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </span>
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
        </div>
        <p className="mt-3 text-3xl font-extrabold tabular-nums tracking-tight text-foreground">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function FactRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 border-b border-border/60 py-2 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-xs' : ''}>{value}</dd>
    </div>
  );
}
