/**
 * Staff contracts and qualifications registry (G-918).
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
import { listStaffContracts, listStaffQualifications } from '@/lib/api/staff';

import { NewContractForm } from '../_components/new-contract-form';
import { NewQualificationForm } from '../_components/new-qualification-form';

export const dynamic = 'force-dynamic';

export default async function StaffContractsPage() {
  await requireSession();
  const [contracts, qualifications] = await Promise.all([
    listStaffContracts(),
    listStaffQualifications(),
  ]);
  const renewals = contracts.filter((row) => row.renewalAlert);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Contracts & qualifications
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Employment contracts with 60-day renewal alerts, plus a qualifications registry.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/staff">Back to staff</Link>
        </Button>
      </div>

      {renewals.length > 0 ? (
        <p
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          role="status"
        >
          {renewals.length} contract{renewals.length === 1 ? '' : 's'} due for renewal within 60
          days.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <NewContractForm />
        <NewQualificationForm />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contracts</CardTitle>
          <CardDescription>
            {contracts.length === 0 ? 'No contracts yet.' : `${contracts.length} contract(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {contracts.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              Record a contract above.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {contracts.map((row) => (
                <li
                  key={row.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="staff-contract-row"
                >
                  <p className="text-sm font-medium text-foreground">
                    {row.contractType} · {row.salaryBand || 'no band'} · {row.status}
                    {row.renewalAlert ? ' · renewal due' : ''}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Staff {row.staffId.slice(0, 8)}… · {row.startDate}
                    {row.endDate ? ` → ${row.endDate}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Qualifications</CardTitle>
          <CardDescription>
            {qualifications.length === 0
              ? 'No qualifications yet.'
              : `${qualifications.length} qualification(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {qualifications.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              Record a qualification above.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {qualifications.map((row) => (
                <li
                  key={row.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="staff-qualification-row"
                >
                  <p className="text-sm font-medium text-foreground">
                    {row.degree} · {row.institution} ({row.year}){row.verified ? ' · verified' : ''}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Staff {row.staffId.slice(0, 8)}…{row.documentRef ? ` · ${row.documentRef}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
