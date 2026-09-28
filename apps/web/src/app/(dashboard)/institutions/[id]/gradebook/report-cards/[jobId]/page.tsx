import Link from 'next/link';

import { listReportCardJobs } from '@/lib/api/gradebook';

export default async function ReportCardJobPage(props: {
  params: Promise<{ id: string; jobId: string }>;
}) {
  const { id, jobId } = await props.params;
  const jobs = await listReportCardJobs();
  const job = jobs.ok ? jobs.data.find((row) => row.id === jobId) : undefined;
  const studentName =
    typeof job?.metadata?.studentName === 'string' ? job.metadata.studentName : 'Student';
  const term = typeof job?.metadata?.term === 'string' ? job.metadata.term : 'Term';

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6" data-testid="report-card-preview">
      <Link href={`/institutions/${id}/gradebook`} className="text-sm font-semibold text-primary">
        Back to gradebook
      </Link>
      <h1 className="text-xl font-semibold">Report card</h1>
      {!job ? (
        <p role="alert">This report card is not available.</p>
      ) : job.status !== 'SUCCEEDED' ? (
        <p role="status">
          {studentName} · {term} is {job.status.toLowerCase()}.
          {job.errorMessage ? ` ${job.errorMessage}` : ''}
        </p>
      ) : (
        <article className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">{term}</p>
          <p className="text-lg font-semibold">{studentName}</p>
          <p className="mt-2 text-sm">
            Published grades for this student are included on the card.
          </p>
        </article>
      )}
    </div>
  );
}
