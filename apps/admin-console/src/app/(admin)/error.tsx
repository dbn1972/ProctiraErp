'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * PRC-H002: privileged write actions (tenant lifecycle, plan entitlements, theme and
 * break-glass decisions) throw when the gateway rejects or cannot be reached. Show that failure
 * to the operator instead of a silent refresh that looks like success.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-4 p-6">
      <Alert variant="destructive">
        <AlertTitle>The action did not complete</AlertTitle>
        <AlertDescription>
          <p>{error.message || 'An unexpected error occurred.'}</p>
          {error.digest ? <p className="mt-1 text-xs">Reference: {error.digest}</p> : null}
        </AlertDescription>
      </Alert>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
