/**
 * Staff scholarship netting (F1) — preview/apply via POST /fees/scholarships/net.
 */
import Link from 'next/link';

import { listInvoicesResult, listNettableScholarshipDisbursementsResult } from '@/lib/api/fees';
import { loadStudentOptions } from '@/lib/load-entity-labels';
import { ScholarshipNettingForm } from '../_components/scholarship-netting-form';
import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { hasDashboardDomainRouteAccess } from '@/lib/auth/domain-route-access';

export const dynamic = 'force-dynamic';

export default async function FeesScholarshipNettingPage() {
  // A-batch: check before any fees read.
  if (!(await hasDashboardDomainRouteAccess('fees', '/fees'))) {
    return <RouteAccessDenied />;
  }
  const [studentOptions, invoicesResult, disbursementsResult] = await Promise.all([
    loadStudentOptions(),
    listInvoicesResult('staff'),
    listNettableScholarshipDisbursementsResult(),
  ]);
  const invoiceOptions = invoicesResult.ok
    ? invoicesResult.items.map((invoice) => ({
        id: invoice.id,
        label: invoice.invoiceNumber?.trim() || invoice.title || 'Invoice',
        searchText: `${invoice.title} ${invoice.invoiceNumber ?? ''} ${invoice.status}`,
      }))
    : [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/fees" className="underline-offset-4 hover:underline">
            Fees
          </Link>
          <span aria-hidden="true"> / </span>
          Scholarship netting
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          Scholarship netting
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Apply a paid scholarship disbursement as a fee credit. Does not create awards — use the
          Scholarships module for that. Not a Blackbaud Tuition complete claim.
        </p>
      </div>
      <ScholarshipNettingForm
        studentOptions={studentOptions}
        disbursements={disbursementsResult.ok ? disbursementsResult.items : []}
        disbursementsFailed={!disbursementsResult.ok}
        invoiceOptions={invoiceOptions}
        invoiceDirectoryFailed={!invoicesResult.ok}
      />
    </div>
  );
}
