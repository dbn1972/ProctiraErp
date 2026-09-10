/**
 * StudentRecords — academic records, transcripts, report cards (WS3).
 *
 * Federated route: `/app/students/records`.
 * Live App Router surface: `/students/records` (preferred for redesign shell).
 */
import { Link } from 'react-router-dom';

export default function StudentRecords() {
  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Student Records</h1>
      <p className="text-muted-foreground max-w-2xl text-sm">
        Official transcripts, GPA snapshots, and report-card jobs are served from the redesign App
        Router against the live gradebook API (raw Postgres — no placeholder stub).
      </p>
      <p>
        <Link
          className="text-primary underline-offset-4 hover:underline"
          to="/students/records"
          reloadDocument
        >
          Open Student Records (live gradebook)
        </Link>
      </p>
      <p className="text-sm text-muted-foreground">
        Institution gradebook:{' '}
        <span className="font-mono text-xs">/institutions/[id]/gradebook</span>
      </p>
    </div>
  );
}
