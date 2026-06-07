/**
 * StudentTransfer — workflow for transferring a student between institutions.
 *
 * Migrated from `School Platform Design/src/app/components/StudentTransfer.tsx`
 * per task 60.2. Real data wiring is task 60.3.
 */
import { useParams } from 'react-router-dom';

export default function StudentTransfer() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Transfer Student {id}</h1>
      <p className="text-muted-foreground mt-2">
        Inter-institution and cross-board transfer workflow. Placeholder pending task 60.3.
      </p>
    </div>
  );
}
