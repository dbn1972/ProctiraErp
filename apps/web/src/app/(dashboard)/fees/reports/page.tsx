/**
 * Staff fee reports (Server Component).
 */
import { requireSession } from '@/lib/auth/server';
import { fetchDuesReport } from '@/lib/api/fees';
import { FeesReportsPanel } from '../_components/fees-reports-panel';

export const dynamic = 'force-dynamic';

export default async function FeesReportsPage() {
  await requireSession();
  const report = await fetchDuesReport();
  return (
    <div className="p-6">
      <FeesReportsPanel report={report} />
    </div>
  );
}
