/**
 * Staff bank/PSP reconciliation (F3) — import, match/exception list, resolve audit.
 */
import Link from 'next/link';

import { requireSession } from '@/lib/auth/server';
import { listReconciliationBatches, listReconciliationRows } from '@/lib/api/fees';
import { ReconciliationWorkspace } from '../_components/reconciliation-workspace';

export const dynamic = 'force-dynamic';

export default async function FeesReconciliationPage({
  searchParams,
}: {
  searchParams?: Promise<{ batch?: string }>;
}) {
  await requireSession();
  const params = (await searchParams) ?? {};
  const batches = await listReconciliationBatches();
  const requested = params?.batch?.trim() || null;
  const selectedBatchId =
    (requested && batches.some((batch) => batch.id === requested) ? requested : null) ??
    batches[0]?.id ??
    null;
  const rows = selectedBatchId ? await listReconciliationRows(selectedBatchId) : [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/fees" className="underline-offset-4 hover:underline">
            Fees
          </Link>
          <span aria-hidden="true"> / </span>
          Reconciliation
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          Reconciliation
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Clear bank or PSP CSV lines against invoices, triage exceptions, and keep an import /
          resolution audit. Sandbox ledger only — not a live PSP or Blackbaud-complete claim.
        </p>
      </div>
      <ReconciliationWorkspace
        batches={batches}
        initialBatchId={selectedBatchId}
        initialRows={rows}
      />
    </div>
  );
}
