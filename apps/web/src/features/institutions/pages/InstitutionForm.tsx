/**
 * InstitutionForm — create/edit form for institutions.
 *
 * Migrated from `School Platform Design/src/app/components/InstitutionForm.tsx`
 * per task 60.2. Real data wiring is task 60.3.
 */
import { useParams } from 'react-router-dom';

export default function InstitutionForm() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">{id ? 'Edit Institution' : 'New Institution'}</h1>
      <p className="text-muted-foreground mt-2">
        Institution registration and edit form. Placeholder pending task 60.3.
      </p>
    </div>
  );
}
