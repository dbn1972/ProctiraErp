'use client';

/**
 * Test-only page for verifying error boundary recovery (Property F-9).
 *
 * This page is only available in development/test environments. It renders
 * a component that throws a render error on demand, allowing Playwright
 * tests to verify that:
 *
 * 1. The PageErrorBoundary catches the error
 * 2. A recoverable UI with "Retry" is shown
 * 3. The sidebar and shell chrome remain mounted
 * 4. Clicking Retry recovers the page
 *
 * Usage: Navigate to `/__tests/error-boundary?throw=1` to trigger the error.
 * Navigate without `?throw=1` to see the normal page content.
 */

import { useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';

function ErrorThrowingContent() {
  const searchParams = useSearchParams();
  const shouldThrow = searchParams.get('throw') === '1';

  if (shouldThrow) {
    throw new Error('Synthetic render error for Property F-9 test');
  }

  return (
    <div data-testid="test-page-content">
      <h1 className="text-2xl font-bold">Error Boundary Test Page</h1>
      <p className="mt-2 text-muted-foreground">
        This page is used to test the error boundary recovery mechanism.
        Add <code>?throw=1</code> to the URL to trigger a render error.
      </p>
    </div>
  );
}

export default function ErrorBoundaryTestPage() {
  // Only render in non-production environments
  const [isAllowed, setIsAllowed] = useState(false);

  useEffect(() => {
    // In production, this page should not be accessible
    if (process.env.NODE_ENV !== 'production') {
      setIsAllowed(true);
    }
  }, []);

  if (!isAllowed) {
    return (
      <div>
        <h1>Not Available</h1>
        <p>This page is only available in development/test environments.</p>
      </div>
    );
  }

  return <ErrorThrowingContent />;
}
