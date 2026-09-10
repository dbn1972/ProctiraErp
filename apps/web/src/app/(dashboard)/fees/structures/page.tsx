/**
 * Staff fee structures (Server Component).
 */
import { requireSession } from '@/lib/auth/server';
import { listFeeStructures } from '@/lib/api/fees';
import { StructuresWorkspace } from '../_components/structures-workspace';

export const dynamic = 'force-dynamic';

export default async function FeesStructuresPage() {
  await requireSession();
  const structures = await listFeeStructures();
  return (
    <div className="p-6">
      <StructuresWorkspace
        structures={structures}
        header={
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Fee structures
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Class × category × term amounts, instalment schedules, and bulk invoicing.
            </p>
          </div>
        }
      />
    </div>
  );
}
