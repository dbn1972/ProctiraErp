/** Skeleton for the timetable tab. Review-only state chips are not rendered. */
export default function InstitutionTimetableLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading timetable" data-testid="institution-timetable-loading">
      <div className="h-16 animate-pulse rounded-xl border bg-card" />
      <div className="h-40 animate-pulse rounded-xl border bg-card" />
      <div className="h-72 animate-pulse rounded-xl border bg-card" />
      <p className="sr-only">Loading timetable</p>
    </div>
  );
}
