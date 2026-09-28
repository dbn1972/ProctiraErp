/** Skeleton for the institution overview tab. Review-only state chips are not rendered. */
export default function InstitutionOverviewLoading() {
  return (
    <div
      className="grid gap-6 lg:grid-cols-[1fr_320px]"
      aria-busy="true"
      aria-label="Loading institution overview"
      data-testid="institution-overview-loading"
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-xl border bg-card" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl border bg-card" />
        <div className="h-48 animate-pulse rounded-xl border bg-card" />
      </div>
      <div className="h-72 animate-pulse rounded-xl border bg-card" />
      <p className="sr-only">Loading institution overview</p>
    </div>
  );
}
