/**
 * Report card job view.
 *
 * PRC-M094: the backend does not yet render or store a PDF (the artifact is
 * an in-memory HTML checksum), so this page is labelled "Preview only" and
 * never offers a PDF. The student name comes from the directory using
 * `metadata.studentId`. Jobs outside the caller's tenant/institution 404.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listReportCardJobs } from '@/lib/api/gradebook';
import { personDisplayName } from '@/lib/entity-label';
import { withStudentLabels } from '@/lib/load-entity-labels';

export default async function ReportCardJobPage(props: {
  params: Promise<{ id: string; jobId: string }>;
}) {
  const { id, jobId } = await props.params;
  const jobs = await listReportCardJobs();
  const job = jobs.ok ? jobs.data.find((row) => row.id === jobId) : undefined;
  if (!job || (job.institutionId && job.institutionId !== id)) notFound();
  const studentId = typeof job.metadata?.studentId === 'string' ? job.metadata.studentId : '';
  const labels = studentId ? await withStudentLabels(new Map(), [studentId]) : new Map();
  const studentName = personDisplayName(
    labels.get(studentId),
    typeof job.metadata?.studentName === 'string' ? job.metadata.studentName : '',
    'Unknown student',
  );
  const term = typeof job.metadata?.term === 'string' ? job.metadata.term : 'Term';
  const gradeCount = typeof job.metadata?.gradeCount === 'number' ? job.metadata.gradeCount : null;
  return (
    <div className="mx-auto max-w-xl space-y-4 p-6" data-testid="report-card-preview">
      <Link href={`/institutions/${id}/gradebook`} className="text-sm font-semibold text-primary">
        Back to gradebook
      </Link>
      <h1 className="text-xl font-semibold">Report card</h1>
      {job.status !== 'SUCCEEDED' ? (
        <p role="status">
          {studentName} · {term} is {job.status.toLowerCase()}.
          {job.errorMessage ? ` ${job.errorMessage}` : ''}
        </p>
      ) : (
        <article className="space-y-2 rounded-lg border p-4">
          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
            Preview only
          </span>
          <p className="text-sm text-muted-foreground">{term}</p>
          <p className="text-lg font-semibold">{studentName}</p>
          <p className="text-sm">
            {gradeCount !== null
              ? `${gradeCount} published grade${gradeCount === 1 ? '' : 's'} included.`
              : 'Published grades for this student are included.'}
          </p>
          <p className="text-xs text-muted-foreground">
            A downloadable PDF is not available yet. This page confirms the card was generated.
          </p>
        </article>
      )}
    </div>
  );
}
