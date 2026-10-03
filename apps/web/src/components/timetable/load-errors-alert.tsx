import Link from 'next/link';
import { Card, CardContent } from '@proctira/ui/components';
import type { LoadFailure } from '@/lib/timetable/load-errors';

/** PRC-M100: names each failed read and offers a retry link. */
export function LoadErrorsAlert({
  title,
  failures,
  retryHref,
}: {
  title: string;
  failures: LoadFailure[];
  retryHref: string;
}) {
  if (failures.length === 0) return null;
  return (
    <Card>
      <CardContent className="space-y-2 p-6">
        <div className="text-sm" role="alert" data-testid="timetable-load-errors">
          <p className="font-semibold">{title}</p>
          <ul className="mt-1 list-disc space-y-0.5 ps-5 text-muted-foreground">
            {failures.map((f) => (
              <li key={f.what}>
                <span className="font-medium text-foreground">{f.what}:</span> {f.detail}
              </li>
            ))}
          </ul>
          <Link
            href={retryHref}
            className="mt-2 inline-flex min-h-11 items-center font-semibold underline"
          >
            Retry
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

/** PRC-M102: visible notice when the staff picker hit its cap. */
export function StaffTruncationNotice({ shown, total }: { shown: number; total: number }) {
  return (
    <p
      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
      role="status"
      data-testid="staff-truncation-notice"
    >
      Showing the first {shown.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')} staff in
      the teacher pickers. Assign staff to this institution or refine the list in the{' '}
      <Link href="/staff" className="font-semibold underline">
        staff directory
      </Link>
      .
    </p>
  );
}
