export default function DashboardLoading() {
  return (
    <div className="space-y-4 p-6" role="status" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="h-4 w-72 animate-pulse rounded bg-muted" />
      <div className="mt-6 h-64 animate-pulse rounded-md bg-muted" />
    </div>
  );
}
