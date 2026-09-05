/**
 * Scholarship applications list (Server Component).
 *
 * Layout per redesign/web/scholarships-applications.html:
 *  - Page head with Export CTA
 *  - Status tabs (All / Pending / Under review / Approved / Rejected)
 *  - Table: avatar person-cell, program, submitted, score, status, actions
 *
 * Validates: Requirement 11.1 — review and triage scholarship applications.
 */
import Link from 'next/link';
import { Eye, MoreVertical } from 'lucide-react';

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
import { listScholarshipApplications, type ScholarshipApplication } from '@/lib/api/scholarships';
import { cn } from '@/lib/utils';

import { ApplicationStatusTabs } from '../_components/application-status-tabs';
import { ApplicationsExportButton } from '../_components/applications-export-button';

export const dynamic = 'force-dynamic';

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
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
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

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

function readStringParam(
  params: PageProps['searchParams'],
  key: string,
  defaultValue = '',
): string {
  if (!params) return defaultValue;
  const value = params[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) return value[0] ?? defaultValue;
  return defaultValue;
}

export default async function ScholarshipApplicationsPage({ searchParams }: PageProps) {
  const status = readStringParam(searchParams, 'status', 'ALL');
  const programId = readStringParam(searchParams, 'programId');

  const applications = await listScholarshipApplications();
  const scoped = programId ? applications.filter((a) => a.programId === programId) : applications;

  const counts = {
    ALL: scoped.length,
    PENDING: scoped.filter((a) => a.status === 'PENDING').length,
    UNDER_REVIEW: scoped.filter((a) => a.status === 'UNDER_REVIEW').length,
    APPROVED: scoped.filter((a) => a.status === 'APPROVED').length,
    REJECTED: scoped.filter((a) => a.status === 'REJECTED').length,
  };

  const filtered = status && status !== 'ALL' ? scoped.filter((a) => a.status === status) : scoped;

  const awaiting = counts.PENDING + counts.UNDER_REVIEW;

  return (
    <section aria-labelledby="applications-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="applications-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Scholarship applications
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review, verify, and approve applications across all programs. Approvals trigger the DBT
            disbursement queue automatically.
            {scoped.length > 0
              ? ` ${scoped.length.toLocaleString()} applications received, ${awaiting.toLocaleString()} awaiting approval.`
              : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <ApplicationsExportButton applications={filtered} />
        </div>
      </div>

      <ApplicationStatusTabs activeStatus={status} counts={counts} />

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {scoped.length === 0
              ? 'No applications submitted.'
              : 'No applications match this status filter.'}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table aria-label="Applications">
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="ps-4 font-semibold">Applicant</TableHead>
                    <TableHead className="font-semibold">Program</TableHead>
                    <TableHead className="font-semibold">Submitted</TableHead>
                    <TableHead className="font-semibold text-end">Score</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="pe-4 text-end font-semibold">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((app) => (
                    <ApplicationRow key={app.id} app={app} />
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="border-t px-4 py-3 text-sm text-muted-foreground">
              Showing <span className="font-semibold text-foreground">1–{filtered.length}</span> of{' '}
              <span className="font-semibold text-foreground">{filtered.length}</span> applications
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function ApplicationRow({ app }: { app: ScholarshipApplication }) {
  return (
    <TableRow className="group">
      <TableCell className="ps-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold',
              avatarPalette(app.applicantName),
            )}
          >
            {initialsOf(app.applicantName)}
          </span>
          <div className="min-w-0">
            <Link
              href={`/scholarships/applications/${app.id}`}
              className="block truncate font-semibold text-foreground hover:underline"
            >
              {app.applicantName}
            </Link>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {app.applicantId}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="font-medium text-foreground">{app.programName}</div>
      </TableCell>
      <TableCell className="text-sm">{formatDate(app.submittedAt)}</TableCell>
      <TableCell className="text-end tabular-nums">
        {app.totalScore !== null && app.totalScore !== undefined ? app.totalScore.toFixed(1) : '—'}
      </TableCell>
      <TableCell>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
            STATUS_COLOURS[app.status],
          )}
        >
          {STATUS_LABELS[app.status]}
        </span>
      </TableCell>
      <TableCell className="pe-4">
        <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8 p-0">
            <Link href={`/scholarships/applications/${app.id}`} aria-label="Review">
              <Eye className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 p-0" aria-label="More">
            <MoreVertical className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
