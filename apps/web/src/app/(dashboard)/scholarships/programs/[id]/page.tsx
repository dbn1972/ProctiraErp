/**
 * Scholarship program detail page.
 *
 * Layout per redesign/web/scholarships-program-detail.html:
 *  - Page head with status pill + View applications / Edit CTAs
 *  - KPI cards (applications, approved, slots)
 *  - Application funnel from status counts
 *  - Recent applications table
 *  - Sidebar: window countdown + program facts
 *
 * Validates: Requirement 11.1 — view scholarship program detail.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CheckCircle2, Eye, FileText, Pencil, Users } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import {
  getScholarshipProgram,
  listScholarshipApplications,
  type ScholarshipApplication,
  type ScholarshipProgram,
} from '@/lib/api/scholarships';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

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

const APP_STATUS_LABELS: Record<ScholarshipApplication['status'], string> = {
  PENDING: 'Pending',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

const APP_STATUS_COLOURS: Record<ScholarshipApplication['status'], string> = {
  APPROVED: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  UNDER_REVIEW: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
  PENDING: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  REJECTED: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400',
};

const AVATAR_PALETTES = [
  'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
  'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900 dark:text-fuchsia-300',
] as const;

function avatarPalette(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length] ?? AVATAR_PALETTES[0];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase() || '—';
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function daysUntil(iso: string): number | null {
  try {
    const end = new Date(iso).getTime();
    const now = Date.now();
    return Math.ceil((end - now) / (24 * 60 * 60 * 1000));
  } catch {
    return null;
  }
}

function windowProgress(start: string, end: string): number | null {
  try {
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    if (e <= s) return null;
    const pct = ((Date.now() - s) / (e - s)) * 100;
    return Math.min(100, Math.max(0, pct));
  } catch {
    return null;
  }
}

export default async function ScholarshipProgramPage({ params }: PageProps) {
  const [program, allApps] = await Promise.all([
    getScholarshipProgram(params.id),
    listScholarshipApplications(),
  ]);
  if (!program) notFound();

  const apps = allApps.filter((a) => a.programId === program.id);
  const approved = apps.filter((a) => a.status === 'APPROVED').length;
  const pending = apps.filter((a) => a.status === 'PENDING' || a.status === 'UNDER_REVIEW').length;
  const rejected = apps.filter((a) => a.status === 'REJECTED').length;
  const recent = apps.slice(0, 8);
  const daysLeft = daysUntil(program.applicationEndDate);
  const progress = windowProgress(program.applicationStartDate, program.applicationEndDate);
  const funnelMax = Math.max(apps.length, 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">{program.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-mono">{program.code}</span> ·{' '}
            {formatMoney(program.awardAmount, program.currency)} per student ·{' '}
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
          <Button asChild size="sm">
            <Link href={`/scholarships/programs/${program.id}/edit`}>
              <Pencil className="me-1.5 h-4 w-4" aria-hidden="true" />
              Edit program
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard
              icon={<FileText className="h-5 w-5" aria-hidden="true" />}
              iconClass="bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
              label="Applications"
              value={apps.length.toLocaleString()}
              foot={`${pending.toLocaleString()} awaiting review`}
            />
            <KpiCard
              icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
              iconClass="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
              label="Approved"
              value={approved.toLocaleString()}
              foot={
                apps.length > 0
                  ? `${((approved / apps.length) * 100).toFixed(1)}% of applications`
                  : 'No applications yet'
              }
            />
            <KpiCard
              icon={<Users className="h-5 w-5" aria-hidden="true" />}
              iconClass="bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400"
              label="Total slots"
              value={program.totalSlots.toLocaleString()}
              foot={formatMoney(program.awardAmount, program.currency) + ' each'}
            />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Application funnel</CardTitle>
              <CardDescription>From submission to decision</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <FunnelRow
                label="Submitted"
                count={apps.length}
                max={funnelMax}
                barClass="bg-blue-300 dark:bg-blue-700"
              />
              <FunnelRow
                label="Under review"
                count={apps.filter((a) => a.status === 'UNDER_REVIEW').length}
                max={funnelMax}
                barClass="bg-blue-500"
              />
              <FunnelRow
                label="Approved"
                count={approved}
                max={funnelMax}
                barClass="bg-emerald-500"
              />
              <FunnelRow label="Rejected" count={rejected} max={funnelMax} barClass="bg-red-500" />
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Recent applications</CardTitle>
                  <CardDescription>Latest submissions for this program</CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/scholarships/applications?programId=${program.id}`}>
                    View all →
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {recent.length === 0 ? (
                <p className="border-t py-10 text-center text-sm text-muted-foreground">
                  No applications for this program yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table aria-label="Recent applications">
                    <TableHeader>
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableHead className="ps-4 font-semibold">Student</TableHead>
                        <TableHead className="font-semibold">Applied</TableHead>
                        <TableHead className="font-semibold">Status</TableHead>
                        <TableHead className="pe-4 text-end font-semibold">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recent.map((app) => (
                        <TableRow key={app.id} className="group">
                          <TableCell className="ps-4">
                            <div className="flex items-center gap-3">
                              <span
                                aria-hidden="true"
                                className={cn(
                                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                                  avatarPalette(app.applicantName),
                                )}
                              >
                                {initialsOf(app.applicantName)}
                              </span>
                              <span className="font-medium">{app.applicantName}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{formatDate(app.submittedAt)}</TableCell>
                          <TableCell>
                            <span
                              className={cn(
                                'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
                                APP_STATUS_COLOURS[app.status],
                              )}
                            >
                              {APP_STATUS_LABELS[app.status]}
                            </span>
                          </TableCell>
                          <TableCell className="pe-4">
                            <div className="flex justify-end opacity-60 group-hover:opacity-100">
                              <Button asChild variant="ghost" size="icon" className="h-8 w-8 p-0">
                                <Link
                                  href={`/scholarships/applications/${app.id}`}
                                  aria-label={`View ${app.applicantName}`}
                                >
                                  <Eye className="h-4 w-4" aria-hidden="true" />
                                </Link>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardContent className="p-5 text-center">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Window closes in
              </p>
              <div className="mt-2 flex items-baseline justify-center gap-2">
                <span className="text-4xl font-extrabold tracking-tight text-primary tabular-nums">
                  {daysLeft !== null ? Math.max(0, daysLeft) : '—'}
                </span>
                <span className="text-sm font-semibold text-muted-foreground">days</span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {formatDate(program.applicationStartDate)} –{' '}
                {formatDate(program.applicationEndDate)}
              </p>
              {progress !== null ? (
                <>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-end text-[11px] text-muted-foreground">
                    {progress.toFixed(0)}% of window elapsed
                  </p>
                </>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Program facts</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="text-sm">
                <FactRow label="Code" value={program.code} mono />
                <FactRow
                  label="Award"
                  value={`${formatMoney(program.awardAmount, program.currency)} / yr`}
                />
                <FactRow label="Total slots" value={program.totalSlots.toLocaleString()} />
                <FactRow
                  label="Application opens"
                  value={formatDate(program.applicationStartDate)}
                />
                <FactRow
                  label="Application closes"
                  value={formatDate(program.applicationEndDate)}
                />
                <FactRow label="Status" value={STATUS_LABELS[program.status]} />
              </dl>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function FunnelRow({
  label,
  count,
  max,
  barClass,
}: {
  label: string;
  count: number;
  max: number;
  barClass: string;
}) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="grid grid-cols-[110px_1fr_56px] items-center gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="h-5 overflow-hidden rounded-md bg-muted">
        <div
          className={cn('h-full rounded-md', barClass)}
          style={{ width: `${Math.max(pct, count > 0 ? 4 : 0)}%` }}
        />
      </div>
      <span className="text-end text-sm font-bold tabular-nums">{count.toLocaleString()}</span>
    </div>
  );
}

function KpiCard({
  icon,
  iconClass,
  label,
  value,
  foot,
}: {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  value: string;
  foot?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2">
          <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg', iconClass)}>
            {icon}
          </span>
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
        </div>
        <p className="mt-3 text-3xl font-extrabold tabular-nums tracking-tight text-foreground">
          {value}
        </p>
        {foot ? <p className="mt-1 text-xs text-muted-foreground">{foot}</p> : null}
      </CardContent>
    </Card>
  );
}

function FactRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-4 border-b border-border/60 py-2 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-xs' : ''}>{value}</dd>
    </div>
  );
}
