/**
 * Monthly payroll CSV export (G-918).
 */
import Link from 'next/link';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { exportStaffPayroll, type PayrollExport } from '@/lib/api/staff';

import { PayrollExportPanel } from '../_components/payroll-export-panel';

export const dynamic = 'force-dynamic';

function defaultMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default async function StaffPayrollPage() {
  await requireSession();
  let initial: PayrollExport | null = null;
  try {
    initial = await exportStaffPayroll(defaultMonth());
  } catch {
    initial = null;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Payroll export</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Per-month CSV: staff id, name, salary band, days present, leave days, deductions
            placeholder, payable days. Not a statutory payroll engine.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/staff">Back to staff</Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly extract</CardTitle>
          <CardDescription>Payable days = present + half-day × 0.5. Deductions stay 0.</CardDescription>
        </CardHeader>
        <CardContent>
          <PayrollExportPanel initial={initial} />
        </CardContent>
      </Card>
    </div>
  );
}
