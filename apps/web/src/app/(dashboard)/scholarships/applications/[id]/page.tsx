/**
 * Scholarship application review page.
 *
 * Validates: Requirement 11.1 — application review with score and approval
 * actions.
 */
import { notFound } from 'next/navigation';
import { Check, X } from 'lucide-react';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { getScholarshipApplication } from '@/lib/api/scholarships';

interface PageProps {
  params: { id: string };
}

export default async function ScholarshipApplicationPage({ params }: PageProps) {
  const application = await getScholarshipApplication(params.id);
  if (!application) notFound();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-xl">{application.applicantName}</CardTitle>
              <CardDescription>
                Applied to {application.programName} on {application.submittedAt}
              </CardDescription>
            </div>
            <Badge
              variant={
                application.status === 'APPROVED'
                  ? 'success'
                  : application.status === 'REJECTED'
                    ? 'destructive'
                    : application.status === 'UNDER_REVIEW'
                      ? 'warning'
                      : 'secondary'
              }
            >
              {application.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <SummaryRow label="Applicant ID" value={application.applicantId} mono />
          <SummaryRow label="Program ID" value={application.programId} mono />
          <SummaryRow
            label="Total score"
            value={
              application.totalScore !== null && application.totalScore !== undefined
                ? application.totalScore.toFixed(1)
                : '—'
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Review actions</CardTitle>
          <CardDescription>Approve or reject this application.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button>
            <Check className="me-2 h-4 w-4" aria-hidden="true" />
            Approve
          </Button>
          <Button variant="destructive">
            <X className="me-2 h-4 w-4" aria-hidden="true" />
            Reject
          </Button>
          <Button variant="outline">Request more information</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/50 pb-2 last:border-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-xs' : ''}>{value}</dd>
    </div>
  );
}
