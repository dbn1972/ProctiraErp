'use client';

export default function InstitutionOverviewError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/40 p-4 text-sm"
      data-testid="institution-overview-error"
    >
      <p className="font-medium">Institution details are currently unavailable.</p>
      <button
        type="button"
        className="mt-2 font-semibold underline underline-offset-4"
        onClick={() => reset()}
      >
        Retry
      </button>
    </div>
  );
}
