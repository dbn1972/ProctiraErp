/**
 * Payroll operations desk — structures, runs, payslips.
 * Generate via POST /payroll/runs/generate from a pay structure + staff list.
 */
import Link from 'next/link';
import { Banknote, FileSpreadsheet, Receipt, Wallet } from 'lucide-react';

import { listPayrollRuns, listPayslips, listPayStructures } from '@/lib/api/payroll';
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
  generated: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400',
  draft: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400',
  approved: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  paid: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  void: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  inactive: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
};

function money(amount: number, currency = 'INR') {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function shortId(id: string) {
  return id.slice(0, 8);
}

function periodLabel(year: number, month: number) {
  const label = new Date(year, month - 1, 1).toLocaleString('en-IN', {
    month: 'short',
    year: 'numeric',
  });
  return label;
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize',
        STATUS_STYLES[status] ?? STATUS_STYLES.draft,
      )}
    >
      {status}
    </span>
  );
}

export default async function PayrollPage() {
  const [structures, runs, payslips] = await Promise.all([
    listPayStructures(),
    listPayrollRuns(),
    listPayslips(),
  ]);

  const structureById = new Map(structures.map((s) => [s.id, s]));
  const totalPayroll = runs.reduce((sum, r) => sum + r.totalAmount, 0);
  const netPayslips = payslips.reduce((sum, p) => sum + p.netAmount, 0);

  return (
    <section className="space-y-8" aria-labelledby="payroll-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 id="payroll-heading" className="text-3xl font-extrabold tracking-tight">
            Payroll
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Structure → generate run → payslips — production payroll cycle
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-md border border-border px-2 py-1">POST /payroll/structures</span>
          <span className="rounded-md border border-border px-2 py-1">
            POST /payroll/runs/generate
          </span>
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
            <p className="text-xs text-muted-foreground">Pay catalogues</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Runs</CardTitle>
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" aria-hidden />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{runs.length}</div>
            <p className="text-xs text-muted-foreground">Payroll periods</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Run total</CardTitle>
            <Banknote className="h-4 w-4 text-muted-foreground" aria-hidden />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{money(totalPayroll)}</div>
            <p className="text-xs text-muted-foreground">Sum of run totals</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Payslips</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" aria-hidden />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{payslips.length}</div>
            <p className="text-xs text-muted-foreground">{money(netPayslips)} net</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pay structures</CardTitle>
            <CardDescription>Component catalogues used when generating runs</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Components</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {structures.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      No pay structures yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  structures.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>{s.currency}</TableCell>
                      <TableCell className="max-w-[12rem] truncate text-xs text-muted-foreground">
                        {s.components}
                      </TableCell>
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
            <CardTitle>Payroll runs</CardTitle>
            <CardDescription>Period status and total amount per run</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Structure</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      No runs yet. Use POST /payroll/runs/generate.
                    </TableCell>
                  </TableRow>
                ) : (
                  runs.map((run) => {
                    const structure = run.payStructureId
                      ? structureById.get(run.payStructureId)
                      : undefined;
                    return (
                      <TableRow key={run.id}>
                        <TableCell className="font-medium">
                          {periodLabel(run.periodYear, run.periodMonth)}
                        </TableCell>
                        <TableCell>
                          {structure?.name ??
                            (run.payStructureId ? shortId(run.payStructureId) : '—')}
                        </TableCell>
                        <TableCell>
                          {money(run.totalAmount, structure?.currency ?? 'INR')}
                        </TableCell>
                        <TableCell>
                          <StatusPill status={run.status} />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payslips</CardTitle>
          <CardDescription>Staff gross and net amounts linked to a run</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff</TableHead>
                <TableHead>Run</TableHead>
                <TableHead>Gross</TableHead>
                <TableHead>Net</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payslips.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No payslips yet. Generate a run to create them.
                  </TableCell>
                </TableRow>
              ) : (
                payslips.slice(0, 20).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{shortId(p.staffId)}</TableCell>
                    <TableCell className="font-mono text-xs">{shortId(p.payrollRunId)}</TableCell>
                    <TableCell>{money(p.grossAmount)}</TableCell>
                    <TableCell>{money(p.netAmount)}</TableCell>
                    <TableCell>
                      <StatusPill status={p.status} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Related:{' '}
        <Link className="underline underline-offset-2" href="/finance">
          Finance
        </Link>{' '}
        ·{' '}
        <Link className="underline underline-offset-2" href="/timetable">
          Timetable
        </Link>
      </p>
    </section>
  );
}
