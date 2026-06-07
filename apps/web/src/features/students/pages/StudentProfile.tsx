/**
 * StudentProfile — single-student profile and timeline.
 *
 * Migrated from `School Platform Design/src/app/components/StudentProfile.tsx`
 * per task 60.2. Real data wiring is task 60.3.
 */
import { useParams } from 'react-router-dom';

export default function StudentProfile() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Student {id}</h1>
      <p className="text-muted-foreground mt-2">
        Demographics, enrolment, attendance, and assessment timeline. Placeholder pending task 60.3.
      </p>
    </div>
  );
}
