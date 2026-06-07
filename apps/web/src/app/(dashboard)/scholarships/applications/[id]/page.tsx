/**
 * Scholarship application review page.
 *
 * Validates: Requirement 11.1 — application review with score and approval
 * actions.
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
import { getScholarshipApplication, type ScholarshipApplication } from '@/lib/api/scholarships';
import { cn } from '@/lib/utils';

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
  UNDER_REVIEW: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  PENDING: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  REJECTED: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400',
};

export default async function ScholarshipApplicationPage({ params }: PageProps) {
  const application = await getScholarshipApplication(params.id);
  if (!application) notFound();

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/scholarships/applications">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to applications
        </Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
            {application.applicantName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Applied to {application.programName} on {application.submittedAt} ·{' '}
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
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Applicant</CardTitle>
              <CardDescription>
                Applied to {application.programName} on {application.submittedAt}.
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
              </dl>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Decision</CardTitle>
              <CardDescription>Approve or reject this application.</CardDescription>
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
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="destructive">
                  <X className="me-1.5 h-4 w-4" aria-hidden="true" />
                  Reject
                </Button>
                <Button>
                  <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
                  Approve
                </Button>
              </div>
              <Button variant="outline" className="w-full">
                Request more information
              </Button>
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
