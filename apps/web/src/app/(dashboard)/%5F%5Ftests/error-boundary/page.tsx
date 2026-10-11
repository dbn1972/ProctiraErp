/**
 * Test-only page for verifying error boundary recovery (Property F-9).
 *
 * PRC-L531: this route previously lived under the private `__tests` folder, so
 * Next's App Router never generated it and the e2e that navigates to
 * `/__tests/error-boundary` 404'd. The folder is now `%5F%5Ftests` (the URL
 * segment decodes to `__tests`), so the route is generated, and this server
 * component calls `notFound()` in production so the page returns a real 404
 * there instead of relying on a client-only `NODE_ENV` guard.
 *
 * Usage: navigate to `/__tests/error-boundary?throw=1` to trigger the error;
 * omit `?throw=1` to see the normal content.
 */
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { ErrorThrowingContent } from './error-throwing-content';

export const dynamic = 'force-dynamic';

export default function ErrorBoundaryTestPage() {
  // Server-side gate: in production this route does not exist.
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return (
    <Suspense fallback={null}>
      <ErrorThrowingContent />
    </Suspense>
  );
}
