'use client';

import { useEffect } from 'react';

import { Button } from '@proctira/ui/components';

export function RouteErrorPanel({
  error,
  reset,
  title = 'Something went wrong',
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
}) {
  useEffect(() => {
    console.error('[route] error boundary:', error);
  }, [error]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex flex-col items-center justify-center gap-4 py-16 text-center"
      data-testid="route-error-panel"
    >
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {/* Never render error.message: client-thrown errors can carry SQL, stack or
          internal detail (PRC-L069). Details go to the console; users get a reference. */}
      <p className="max-w-md text-sm text-muted-foreground">
        An unexpected error occurred while loading this page.
      </p>
      {error.digest ? (
        <p className="text-xs text-muted-foreground/70" data-testid="route-error-digest">
          Reference: {error.digest}
        </p>
      ) : null}
      <Button type="button" onClick={() => reset()} data-testid="route-error-reset">
        Try again
      </Button>
    </div>
  );
}
