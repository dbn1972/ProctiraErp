/**
 * Health vaccinations register (Wave 10 Option B).
 */
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';

import { Button, Card, CardContent } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { canAccessHealthRecords, listVaccinations } from '@/lib/api/health';

export const dynamic = 'force-dynamic';

export default async function HealthVaccinationsPage() {
  const session = await requireSession('/health/vaccinations');
  if (!canAccessHealthRecords(session.user.roles ?? [])) {
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        You need a health role to view vaccinations.
      </p>
    );
  }
  const rows = await listVaccinations();

  return (
    <div className="space-y-6 p-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/health">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Health
        </Link>
      </Button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vaccinations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Immunisation register from live vaccination rows. Record a new dose any time.
          </p>
        </div>
        <Button asChild className="min-h-11">
          <Link href="/health/vaccinations/new">
            <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
            New vaccination
          </Link>
        </Button>
      </div>
      <Card>
        <CardContent className="p-6">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No vaccinations recorded yet. Create the first dose.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {rows.slice(0, 100).map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-2 py-3">
                  <div>
                    <Link href={`/health/${r.studentId}`} className="font-medium hover:underline">
                      {r.studentId.slice(0, 8)}…
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {r.vaccineName}
                      {r.doseNumber != null ? ` · dose ${r.doseNumber}` : ''}
                      {r.dateAdministered ? ` · ${r.dateAdministered}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
