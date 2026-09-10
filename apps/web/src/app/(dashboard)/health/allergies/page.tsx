/**
 * Health allergies register (Wave 10 Option B).
 */
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';

import { Button, Card, CardContent } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { canAccessHealthRecords, listHealthRecords } from '@/lib/api/health';

export const dynamic = 'force-dynamic';

export default async function HealthAllergiesPage() {
  const session = await requireSession('/health/allergies');
  if (!canAccessHealthRecords(session.user.roles ?? [])) {
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        You need a health role to view allergies.
      </p>
    );
  }
  const records = await listHealthRecords();
  const flagged = records.filter((r) => (r.allergies?.length ?? 0) > 0);

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
          <h1 className="text-2xl font-semibold tracking-tight">Allergies</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Students with allergy flags from live health records. Record new allergies any time.
          </p>
        </div>
        <Button asChild className="min-h-11">
          <Link href="/health/allergies/new">
            <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
            New allergy
          </Link>
        </Button>
      </div>
      <Card>
        <CardContent className="p-6">
          {flagged.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No allergy flags yet. Create the first record.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {flagged.map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-2 py-3">
                  <div>
                    <Link href={`/health/${r.studentId}`} className="font-medium hover:underline">
                      {r.studentName}
                    </Link>
                    <p className="text-xs text-muted-foreground">{(r.allergies ?? []).join(', ')}</p>
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
