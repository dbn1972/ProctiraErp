/**
 * Finance / Fees operations desk — production fee cycle surface.
 * Structures → assignments → invoices → payments with status pills.
 */
import Link from 'next/link';
import { Banknote, FileText, Receipt, Wallet } from 'lucide-react';

import {
  listFeeAssignments,
  listFeeStructures,
  listInvoices,
  listPayments,
  type Invoice,
} from '@/lib/api/finance';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  open: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400',
  partial: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400',
  paid: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  void: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
};

function money(amount: number, currency = 'INR') {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize',
        STATUS_STYLES[status] ?? STATUS_STYLES.open,
      )}
    >
      {status}
    </span>
  );
}

function balance(inv: Invoice) {
  return Math.max(0, inv.amountDue - inv.amountPaid);
}

export default async function FinancePage() {
  const [structures, assignments, invoices, payments] = await Promise.all([
    listFeeStructures(),
    listFeeAssignments(),
    listInvoices(),
    listPayments(),
  ]);

  const openBalance = invoices
    .filter((i) => i.status === 'open' || i.status === 'partial')
    .reduce((sum, i) => sum + balance(i), 0);
  const collected = payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <section className="space-y-8" aria-labelledby="finance-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 id="finance-heading" className="text-3xl font-extrabold tracking-tight">
            Finance / Fees
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Structure → assign → invoice → collect — production fee cycle
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-md border border-border px-2 py-1">POST /fees/assignments</span>
          <span className="rounded-md border border-border px-2 py-1">
            POST /fees/invoices/generate
          </span>
          <span className="rounded-md border border-border px-2 py-1">POST /fees/payments</span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Structures</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" aria-hidden />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{structures.length}</div>
            <p className="text-xs text-muted-foreground">Active fee catalogues</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Assignments</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{assignments.length}</div>
            <p className="text-xs text-muted-foreground">Student fee links</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open balance</CardTitle>
            <Banknote className="h-4 w-4 text-muted-foreground" aria-hidden />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{money(openBalance)}</div>
            <p className="text-xs text-muted-foreground">Unpaid invoice remainder</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Collected</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" aria-hidden />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{money(collected)}</div>
            <p className="text-xs text-muted-foreground">{payments.length} receipts</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Fee structures</CardTitle>
            <CardDescription>Catalogue amounts by academic year</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {structures.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      No fee structures yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  structures.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>{s.academicYear}</TableCell>
                      <TableCell>{money(s.amount, s.currency)}</TableCell>
                      <TableCell>
                        <StatusPill status={s.status} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>Generated dues with payment progress</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      No invoices yet. Assign fees, then generate.
                    </TableCell>
                  </TableRow>
                ) : (
                  invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-xs">{inv.invoiceNumber}</TableCell>
                      <TableCell>{money(inv.amountDue, inv.currency)}</TableCell>
                      <TableCell>{money(inv.amountPaid, inv.currency)}</TableCell>
                      <TableCell>
                        <StatusPill status={inv.status} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
       