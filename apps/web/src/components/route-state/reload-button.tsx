'use client';

/**
 * A retry control for a failed server-component read.
 *
 * `ListLoadFailure` is rendered from server components: the data was fetched during the
 * render, so there is no client-side query to re-run and nothing for a `reset()` to reset.
 * `router.refresh()` re-runs the server render while keeping client state, which is the
 * closest thing to "try that read again" available here — and it is what the panel's own
 * copy ("Reload the page to try again") was asking the user to do by hand.
 *
 * Its own file, and a client component, because `list-load-failure.tsx` is imported by
 * server components; marking that module `'use client'` would pull every consumer over the
 * boundary.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@proctira/ui/components';

export function ReloadButton({
  label = 'Try again',
  // V15-17: supplied by `getListFailureCopy()`; defaults keep unmigrated callers working.
  retryingLabel = 'Retrying…',
}: {
  label?: string;
  retryingLabel?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // `refresh()` resolves before the new render is committed, so a bare `isPending` flicks
  // back to idle while the user is still looking at the old failure. Latch it until this
  // component is replaced by a successful render or a fresh failure.
  const [attempted, setAttempted] = useState(false);
  const busy = isPending || attempted;

  return (
    <Button
      type="button"
      size="sm"
      disabled={busy}
      aria-busy={busy}
      data-testid="list-load-failure-retry"
      onClick={() => {
        setAttempted(true);
        startTransition(() => {
          router.refresh();
        });
      }}
    >
      {busy ? retryingLabel : label}
    </Button>
  );
}
