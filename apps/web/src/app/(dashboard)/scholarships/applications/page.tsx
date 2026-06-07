/**
 * Scholarship applications list (Server Component).
 *
 * Validates: Requirement 11.1 — review and triage scholarship applications.
 */
import Link from 'next/link';
import { ArrowLeft, Download, Eye, MoreVertical } from 'lucide-react';

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
import {
  listScholarshipApplications,
  type ScholarshipApplication,
} from '@/lib/api/scholarships';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<ScholarshipApplication['status'], string> = {
  PENDING: 'Pending',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

const STATUS_COLOURS: Record<ScholarshipApplication['status'], string> = {
  APPROVED: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  UNDER_REVIEW: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  PENDING: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  REJECTED: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400',
};

export default async function ScholarshipApplicationsPage() {
  const applications = await listScholarshipApplications();
  const awaiting = applications.filter(
    (app) => app.status === 'PENDING' || app.status === 'UNDER_REVIEW',
  ).length;

  return (
    <section aria-labelledby="applications-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/scholarships">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Scholarships
        </Link>
      </Button>

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
            {applications.length > 0
              ? ` ${applications.length.toLocaleString()} applications received, ${awaiting.toLocaleString()} awaiting approval.`
              : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" size="sm">
            <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
            Export
          </Button>
        </div>
      </div>

      {applications.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No applications submitted.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <Table aria-label="Applications">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="font-semibold">Applicant</TableHead>
                  <TableHead className="font-semibold">Program</TableHead>
                  <TableHead className="font-semibold">Submitted</TableHead>
                  <TableHead className="font-semibold text-end">Score</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="font-semibold text-end">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((app) => (
                  <TableRow key={app.id} className="group">
                    <TableCell>
                      <Link
                        href={`/scholarships/applications/${app.id}`}
                        className="font-semibold text-foreground hover:underline"
                      >
                        {app.applicantName}
                      </Link>
                    </TableCell>
                    <TableCell>{app.programName}</TableCell>
                    <TableCell>{app.submittedAt}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {app.totalScore !== null && app.totalScore !== undefined
                        ? app.totalScore.toFixed(1)
                        : '—'}
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
                    <TableCell>
                      <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                        <Button asChild variant="ghost" size="icon" className="h-8 w-8 p-0">
                          <Link
                            href={`/scholarships/applications/${app.id}`}
                            aria-label="Review"
                          >
                            <Eye className="h-4 w-4" aria-hidden="true" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 p-0"
                          aria-label="More"
                        >
                          <MoreVertical className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="border-t px-4 py-3 text-sm text-muted-foreground">
              Showing{' '}
              <span className="font-semibold text-foreground">1–{applications.length}</span> of{' '}
              <span className="font-semibold text-foreground">{applications.length}</span>{' '}
              applications
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
