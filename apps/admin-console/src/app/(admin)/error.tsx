'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * Segment error boundary for the admin console.
 *
 * PRC-H002: privileged write actions (tenant lifecycle, plan entitlements, theme and break-glass
 * decisions) throw when the gateway rejects or cannot be reached, so the operator sees a failure
 * instead of a silent refresh that looks like success. In production builds Next.js replaces
 * server-action error messages with a generic one plus a digest, so the specific reason is only
 * guaranteed in development and in server logs (look up the reference below).
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
        <AlertTitle>Something went wrong</AlertTitle>
        <AlertDescription>
          <p>The request did not complete. If you submitted a change, it was not applied.</p>
          {error.message ? <p className="mt-1">{error.message}</p> : null}
          {error.digest ? <p className="mt-1 text-xs">Reference: {error.digest}</p> : null}
        </AlertDescription>
      </Alert>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
