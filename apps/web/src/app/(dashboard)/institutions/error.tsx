'use client';

/**
 * Recoverable error state for /institutions.
 * Prototype "SCREEN STATE" chips are review-only and are not rendered here.
 */
export default function InstitutionsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section
      role="alert"
      data-testid="institutions-route-error"
      className="rounded-xl border bg-card p-8 text-center"
    >
      <h1 className="text-xl font-semibold text-foreground">Unable to load institutions</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {error.message || 'The institution service is currently unavailable.'}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Try again
      </button>
    </section>
  );
}
