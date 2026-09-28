/**
 * Route-level loading state for /institutions.
 * Prototype "SCREEN STATE" chips are review-only and are not rendered here.
 */
export default function InstitutionsLoading() {
  return (
    <section aria-busy="true" aria-live="polite" data-testid="institutions-loading" className="space-y-6">
      <div className="space-y-2">
        <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-72 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-xl border bg-card" />
        ))}
      </div>
      <div className="h-14 animate-pulse rounded-xl border bg-card" />
      <div className="space-y-2 rounded-xl border bg-card p-4">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-12 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
      <p className="sr-only">Loading institutions</p>
    </section>
  );
}
