/**
 * Scholarship applications list (Server Component).
 *
 * Validates: Requirement 11.1 — review and triage scholarship applications.
 */
import Link from 'next/link';

import {
  Badge,
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
  listScholarshipApplications,
  type ScholarshipApplication,
} from '@/lib/api/scholarships';

export const dynamic = 'force-dynamic';

export default async function ScholarshipApplicationsPage() {
  const applications = await listScholarshipApplications();

  return (
    <section aria-labelledby="applications-heading" className="space-y-6">
      <header>
        <h1 id="applications-heading" className="text-2xl font-semibold tracking-tight">
          Scholarship applications
        </h1>
        <p className="text-sm text-muted-foreground">
          Review applications, score candidates, and approve awards.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All applications</CardTitle>
          <CardDescription>
            {applications.length.toLocaleString()} applications received.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {applications.length === 0 ? (
            <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              No applications submitted.
            </p>
          ) : (
            <Table aria-label="Applications">
              <TableHeader>
                <TableRow>
                  <TableHead>Applicant</TableHead>
                  <TableHead>Program</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-end">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((app) => (
                  <TableRow key={app.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/scholarships/applications/${app.id}`}
                        className="text-primary hover:underline"
                      >
                        {app.applicantName}
                      </Link>
                    </TableCell>
                    <TableCell>{app.programName}</TableCell>
                    <TableCell>{app.submittedAt}</TableCell>
                    <TableCell className="text-right">
                      {app.totalScore !== null && app.totalScore !== undefined
                        ? app.totalScore.toFixed(1)
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <ApplicationStatus status={app.status} />
                    </TableCell>
                    <TableCell className="text-end">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/scholarships/applications/${app.id}`}>Review</Link>
                      </Button>
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

function ApplicationStatus({ status }: { status: ScholarshipApplication['status'] }) {
  switch (status) {
    case 'APPROVED':
      return <Badge variant="success">Approved</Badge>;
    case 'REJECTED':
      return <Badge variant="destructive">Rejected</Badge>;
    case 'UNDER_REVIEW':
      return <Badge variant="warning">Under review</Badge>;
    default:
      return <Badge variant="secondary">Pending</Badge>;
  }
}
