/**
 * InstitutionDetail — single-institution profile view.
 *
 * Migrated from `School Platform Design/src/app/components/InstitutionDetail.tsx`
 * per task 60.2. Real data wiring is task 60.3.
 */
import { useParams } from 'react-router-dom';

export default function InstitutionDetail() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Institution {id}</h1>
      <p className="text-muted-foreground mt-2">
        Profile, classes, and staff for the selected institution. Placeholder pending task 60.3.
      </p>
    </div>
  );
}
