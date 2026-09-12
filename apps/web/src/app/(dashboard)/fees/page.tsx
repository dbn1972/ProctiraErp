/**
 * Staff fees hub (Server Component).
 */
import Link from 'next/link';
import {
  FileText,
  Receipt,
  Wallet,
  Layers,
  BarChart3,
  GraduationCap,
  Bell,
  Scale,
} from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { getTranslations } from 'next-intl/server';

import { requireSession } from '@/lib/auth/server';
import { listFeePlans, listInvoices, listReceipts } from '@/lib/api/fees';

export const dynamic = 'force-dynamic';

export default async function FeesOverviewPage() {
  await requireSession();
  const [t, plans, invoices, receipts] = await Promise.all([
    getTranslations('fees'),
    listFeePlans(),
    listInvoices('staff'),
    listReceipts('staff'),
  ]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4" aria-hidden="true" />
              {t('plans')}
            </CardTitle>
            <CardDescription>{t('planCount', { count: plans.length })}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/fees/plans">{t('managePlans')}</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" aria-hidden="true" />
              {t('invoices')}
            </CardTitle>
            <CardDescription>{t('invoiceCount', { count: invoices.length })}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/fees/invoices">{t('manageInvoices')}</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="h-4 w-4" aria-hidden="true" />
              {t('receipts')}
            </CardTitle>
            <CardDescription>{t('receiptCount', { count: receipts.length })}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/fees/receipts">{t('viewReceipts')}</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4" aria-hidden="true" />
              Structures
            </CardTitle>
            <CardDescription>Class × category × term fee structures.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/fees/structures" data-testid="open-structures">
                Manage structures
              </Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
              Reports
            </CardTitle>
            <CardDescription>Dues summary and CSV export.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/fees/reports" data-testid="open-reports">
                Open reports
              </Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="h-4 w-4" aria-hidden="true" />
              Reconciliation
            </CardTitle>
            <CardDescription>CSV import, match/exception list, and resolve audit.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/fees/reconciliation" data-testid="open-reconciliation">
                Open reconciliation
              </Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GraduationCap className="h-4 w-4" aria-hidden="true" />
              Scholarship netting
            </CardTitle>
            <CardDescription>
              Apply paid disbursement credits to open student invoices.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/fees/scholarship-netting" data-testid="open-scholarship-netting">
                Open netting
              </Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="h-4 w-4" aria-hidden="true" />
              Dunning / reminders
            </CardTitle>
            <CardDescription>
              Overdue feed, suppressions, and sandbox email/SMS send audit.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/fees/dunning" data-testid="open-dunning">
                Open dunning
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
