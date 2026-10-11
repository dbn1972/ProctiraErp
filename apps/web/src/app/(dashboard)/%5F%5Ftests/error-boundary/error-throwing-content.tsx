'use client';

/**
 * Client half of the error-boundary test page (Property F-9). Reads `?throw=1`
 * and throws a render error so the surrounding PageErrorBoundary can be
 * exercised by Playwright. The production gate lives in the server `page.tsx`
 * (PRC-L531), so this component never ships behaviour to prod routes.
 */
import { useSearchParams } from 'next/navigation';

export function ErrorThrowingContent() {
  const searchParams = useSearchParams();
  const shouldThrow = searchParams.get('throw') === '1';

  if (shouldThrow) {
    throw new Error('Synthetic render error for Property F-9 test');
  }

  return (
    <div data-testid="test-page-content">
      <h1 className="text-2xl font-bold">Error Boundary Test Page</h1>
      <p className="mt-2 text-muted-foreground">
        This page is used to test the error boundary recovery mechanism. Add <code>?throw=1</code>{' '}
        to the URL to trigger a render error.
      </p>
    </div>
  );
}
