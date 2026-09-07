/**
 * Staff fees hub (Server Component).
 */
import Link from 'next/link';
import { FileText, Receipt, Wallet } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listFeePlans, listInvoices, listReceipts } from '@/lib/api/parent-portal';

export const dynamic = 'force-dynamic';

export default async function FeesOverviewPage() {
  await requireSession();
  const [plans, invoices, receipts] = await Promise.all([
    listFeePlans(),
    listInvoices('staff'),
    listReceipts('staff'),
  ]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Fees</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fee plans, student invoices, sandbox payments, and receipts. Live PSP is waived —
          parents pay via sandbox in the family portal.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4" aria-hidden="true" />
              Plans
            </CardTitle>
            <CardDescription>
              {plans.length === 0 ? 'No plans yet.' : `${plans.length} plan(s).`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/fees/plans">Manage plans</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" aria-hidden="true" />
              Invoices
            </CardTitle>
            <CardDescription>
              {invoices.length === 0 ? 'No invoices yet.' : `${invoices.length} invoice(s).`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/fees/invoices">Manage invoices</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="h-4 w-4" aria-hidden="true" />
              Receipts
            </CardTitle>
            <CardDescription>
              {receipts.length === 0 ? 'No receipts yet.' : `${receipts.length} receipt(s).`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/fees/receipts">View receipts</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
