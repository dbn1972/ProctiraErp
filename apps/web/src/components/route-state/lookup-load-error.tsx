'use client';
/**
 * Inline alert for form lookups (select options) that failed to load (PRC-M150, PRC-M155).
 *
 * An empty select reads as "there are no institutions"; that is a false statement when the
 * read failed. This names what failed and offers a retry (a server re-render via
 * router.refresh) so the user is not left with an unusable form.
 */
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { ServerCrash } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle, Button } from '@proctira/ui/components';

export function LookupLoadError({
  /** Human labels of the lookups that failed, e.g. ['institutions', 'grades']. */
  failed,
  testId = 'lookup-load-error',
}: {
  failed: readonly string[];
  testId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (failed.length === 0) return null;
  return (
    <Alert variant="destructive" role="alert" data-testid={testId}>
      <ServerCrash className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>Could not load {failed.join(', ')}</AlertTitle>
      <AlertDescription>
        <p>
          The options for this form could not be loaded, so the lists below may be incomplete. Retry
          before submitting.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          disabled={pending}
          aria-busy={pending}
          onClick={() => startTransition(() => router.refresh())}
        >
          {pending ? 'Retrying…' : 'Retry'}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
