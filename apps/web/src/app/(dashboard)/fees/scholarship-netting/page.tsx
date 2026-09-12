/**
 * Staff scholarship netting (F1) — preview/apply via POST /fees/scholarships/net.
 */
import Link from 'next/link';

import { requireSession } from '@/lib/auth/server';
import { ScholarshipNettingForm } from '../_components/scholarship-netting-form';

export const dynamic = 'force-dynamic';

export default async function FeesScholarshipNettingPage() {
  await requireSession();

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
      <ScholarshipNettingForm />
    </div>
  );
}
