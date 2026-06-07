/**
 * StaffProfile — single-staff profile and timeline.
 *
 * Migrated from `School Platform Design/src/app/components/StaffProfile.tsx`
 * per task 60.2. Real data wiring is task 60.3.
 */
import { useParams } from 'react-router-dom';

export default function StaffProfile() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Staff {id}</h1>
      <p className="text-muted-foreground mt-2">
        Personal info, qualifications, and assignments. Placeholder pending task 60.3.
      </p>
    </div>
  );
}
