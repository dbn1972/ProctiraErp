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
