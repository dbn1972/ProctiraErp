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
      <StructuresWorkspace structures={structures} />
    </div>
  );
}
