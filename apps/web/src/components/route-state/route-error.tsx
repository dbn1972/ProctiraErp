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
      <p className="max-w-md text-sm text-muted-foreground">
        {error.message || 'An unexpected error occurred while loading this page.'}
      </p>
      <Button type="button" onClick={() => reset()} data-testid="route-error-reset">
        Try again
      </Button>
    </div>
  );
}
