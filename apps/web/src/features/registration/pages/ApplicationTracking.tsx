/**
 * ApplicationTracking — public lookup for registration application status.
 *
 * Migrated from `School Platform Design/src/app/components/ApplicationTracking.tsx`
 * per task 60.2. Real data wiring is task 60.3.
 */
export default function ApplicationTracking() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Track Application</h1>
      <p className="text-muted-foreground mt-2">
        Look up application status by reference number. Placeholder pending task 60.3.
      </p>
    </div>
  );
}
