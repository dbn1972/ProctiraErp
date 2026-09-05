/**
 * Scholarship application review page.
 *
 * Layout per redesign/web/scholarships-application-detail.html:
 *  - Page head with application id + status pill
 *  - Applicant card with avatar
 *  - Application facts
 *  - Decision sidebar (approve / reject)
 *
 * Validates: Requirement 11.1 — application review with score and approval actions.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Check, X } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Textarea,
} from '@proctira/ui/components';
import {
  getScholarshipApplication,
  getScholarshipProgram,
  type ScholarshipApplication,
} from '@/lib/api/scholarships';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

const STATUS_LABELS: Record<ScholarshipApplication['status'], string> = {
  PENDING: 'Pending',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

const STATUS_COLOURS: Record<ScholarshipApplication['status'], string> = {
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
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return `${first}${last}`.toUpperCase() || '—';
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

export default async function ScholarshipApplicationPage({ params }: PageProps) {
  const application = await getScholarshipApplication(params.id);
  if (!application) notFound();

  const program = await getScholarshipProgram(application.programId);
  const canDecide =
    application.status === 'PENDING' || application.status === 'UNDER_REVIEW';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
            Application{' '}
            <span className="font-mono text-2xl text-muted-foreground">
              {application.id.slice(0, 12)}
            </span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {application.programName} · submitted {formatDate(application.submittedAt)} ·{' '}
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold align-middle',
                STATUS_COLOURS[application.status],
              )}
            >
              {STATUS_LABELS[application.status]}
            </span>
          </p>
        </div>
        <Button asChild variant="ghost" size="sm" className="shrink-0">
          <Link href="/scholarships/applications">
            <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
            Back to applications
          </Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-bold',
                  avatarPalette(application.applicantName),
                )}
              >
                {initialsOf(application.applicantName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xl font-bold text-foreground">
                  {application.applicantName}
                </p>
                <p className="text-sm text-muted-foreground">
                  Applicant ID{' '}
                  <span className="font-mono text-xs">{application.applicantId}</span>
                </p>
              </div>
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <Link href={`/students/${application.applicantId}`}>Student profile</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Application details</CardTitle>
              <CardDescription>
                Applied to {application.programName} on {formatDate(application.submittedAt)}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="text-sm">
                <FactRow label="Applicant" value={application.applicantName} />
                <FactRow label="Applicant ID" value={application.applicantId} mono />
                <FactRow label="Program" value={application.programName} />
                <FactRow
                  label="Total score"
                  value={
                    application.totalScore !== null && application.totalScore !== undefined
                      ? application.totalScore.toFixed(1)
                      : '—'
                  }
                />
                <FactRow label="Status" value={STATUS_LABELS[application.status]} />
                <FactRow label="Submitted" value={formatDate(application.submittedAt)} />
              </dl>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Decision</CardTitle>
              <CardDescription>
                {program
                  ? `Approval queues a ${formatMoney(program.awardAmount, program.currency)} payment`
                  : 'Approve or reject this application.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="decision-comment"
                  className="text-sm font-medium text-foreground"
                >
                  Comment (visible to school)
                </label>
                <Textarea
                  id="decision-comment"
                  rows={3}
                  placeholder="Optional note for the school coordinator…"
                  disabled={!canDecide}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="destructive" disabled={!canDecide}>
                  <X className="me-1.5 h-4 w-4" aria-hidden="true" />
                  Reject
                </Button>
                <Button disabled={!canDecide}>
                  <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
                  Approve
                </Button>
              </div>
              {canDecide ? (
                <p className="text-xs text-muted-foreground">
                  Verify supporting documents before approving — DBT fails if the account is not
                  Aadhaar-seeded.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  This application is already {STATUS_LABELS[application.status].toLowerCase()}.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Application facts</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="text-sm">
                <FactRow label="Program" value={application.programName} />
                {program ? (
                  <FactRow
                    label="Award"
                    value={`${formatMoney(program.awardAmount, program.currency)} / yr`}
                  />
                ) : null}
                <FactRow label="Status" value={STATUS_LABELS[application.status]} />
                <FactRow
                  label="Score"
                  value={
                    application.totalScore !== null && application.totalScore !== undefined
                      ? application.totalScore.toFixed(1)
                      : '—'
                  }
                />
              </dl>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function FactRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-4 border-b border-border/60 py-2 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-xs' : ''}>{value}</dd>
    </div>
  );
}
