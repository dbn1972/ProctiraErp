/**
 * Student records — transcripts, GPA snapshots, report-card jobs (WS3).
 *
 * Route: /students/records
 * Replaces placeholder-only Student Records surface.
 */
import { IssueTranscriptForm } from '@/components/gradebook/issue-transcript-form';
import { Card, CardContent } from '@proctira/ui/components';
import {
  listGpaSnapshots,
  listReportCardJobs,
  listTranscripts,
} from '@/lib/api/gradebook';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: { studentId?: string };
}

export default async function StudentRecordsPage({ searchParams }: PageProps) {
  const studentId = searchParams?.studentId?.trim() || '';

  const [transcriptsResult, jobsResult, gpaResult] = await Promise.all([
    listTranscripts(studentId ? { studentId } : undefined),
    listReportCardJobs(),
    studentId
      ? listGpaSnapshots(studentId)
      : Promise.resolve({ ok: true as const, data: [] }),
  ]);

  const apiError = !transcriptsResult.ok
    ? transcriptsResult.error
    : !jobsResult.ok
      ? jobsResult.error
      : null;

  const transcripts = transcriptsResult.ok ? transcriptsResult.data : [];
  const jobs = jobsResult.ok ? jobsResult.data : [];
  const snapshots = gpaResult.ok ? gpaResult.data : [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Student Records</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Official transcripts (versioned), GPA snapshots, and report-card job status from live
          gradebook data.
        </p>
      </div>

      {apiError ? (
        <Card>
          <CardContent className="space-y-2 p-6">
            <p className="text-sm font-semibold">Records API unavailable</p>
            <p className="text-sm text-muted-foreground" role="alert">
              {apiError}
              {transcriptsResult.ok === false &&
                transcriptsResult.code === 'GRADEBOOK_SCHEMA_MISSING' &&
                ' — apply db/sql/003_sis_timetable_schedule_schema.sql.'}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-base font-semibold">Issue transcript</h2>
          <p className="text-sm text-muted-foreground">
            Each issue creates a new immutable version; prior checksums stay unchanged.
          </p>
          <IssueTranscriptForm defaultStudentId={studentId} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-base font-semibold">Issued transcripts</h2>
          {transcripts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No transcripts yet
              {studentId ? ` for student ${studentId}` : ''}. Issue one above after computing GPA.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Student</th>
                    <th className="py-2 pr-3 font-medium">Version</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Issued</th>
                    <th className="py-2 font-medium">Checksum</th>
                  </tr>
                </thead>
                <tbody>
                  {transcripts.map((row) => (
                    <tr key={row.id} className="border-b border-border/60">
                      <td className="py-2 pr-3 font-mono text-xs">{row.studentId}</td>
                      <td className="py-2 pr-3 tabular-nums">v{row.version}</td>
                      <td className="py-2 pr-3">{row.status}</td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {row.issuedAt ? new Date(row.issuedAt).toLocaleString() : '—'}
                      </td>
                      <td className="py-2 font-mono text-xs">
                        {row.checksumSha256?.slice(0, 16) ?? '—'}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {studentId ? (
        <Card>
          <CardContent className="space-y-3 p-6">
            <h2 className="text-base font-semibold">GPA snapshots</h2>
            {snapshots.length === 0 ? (
              <p className="text-sm text-muted-foreground">No GPA snapshots for this student.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {snapshots.map((s) => (
                  <li key={s.id}>
                    {new Date(s.computedAt).toLocaleString()} · weighted {s.weightedGpa ?? 'n/a'} ·
                    unweighted {s.unweightedGpa ?? 'n/a'} · credits {s.creditsEarned ?? 'n/a'}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-base font-semibold">Report card jobs</h2>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No report-card jobs yet. Trigger from an institution gradebook.
            </p>
          ) : (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {jobs.slice(0, 10).map((job) => (
                <li key={job.id}>
                  {job.status} · student {String(job.metadata.studentId ?? '—')} ·{' '}
                  {job.artifactUri ?? job.errorMessage ?? job.id}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
