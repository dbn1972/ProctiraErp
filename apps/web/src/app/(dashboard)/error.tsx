'use client';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3 p-6" role="alert">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">{error.message || 'Unexpected error'}</p>
      <button
        type="button"
        className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
        onClick={() => reset()}
      >
        Try again
      </button>
    </div>
  );
}
