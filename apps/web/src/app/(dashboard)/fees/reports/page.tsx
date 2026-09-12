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
      <FeesReportsPanel
        report={report}
        header={
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Fee reports</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Dues by class and status. Bank reconciliation lives under Fees → Reconciliation.
            </p>
          </div>
        }
      />
    </div>
  );
}
