'use client';

export default function InstitutionTimetableError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-xl border border-border p-6" role="alert">
      <p className="font-semibold">Timetable API unavailable</p>
      <p className="mt-1 text-sm text-muted-foreground">{props.error.message}</p>
      <button type="button" className="mt-3 text-sm font-semibold underline" onClick={props.reset}>
        Retry
      </button>
    </div>
  );
}
