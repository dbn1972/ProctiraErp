'use client';

export default function InstitutionTimetableError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-xl border border-border p-6" role="alert">
      <p className="font-semibold">Timetable API unavailable</p>
      {/* D1-T5: fixed copy; the error text can carry server detail in development. */}
      <p className="mt-1 text-sm text-muted-foreground">
        The timetable could not be loaded. Try again.
      </p>
      {props.error.digest ? (
        <p className="mt-1 text-xs text-muted-foreground">Reference: {props.error.digest}</p>
      ) : null}
      <button type="button" className="mt-3 text-sm font-semibold underline" onClick={props.reset}>
        Retry
      </button>
    </div>
  );
}
