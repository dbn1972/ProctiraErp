import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';

import { Button, Card, CardContent } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { canAccessHealthRecords, listNurseIncidents } from '@/lib/api/health';

export const dynamic = 'force-dynamic';

export default async function HealthIncidentsPage() {
  const session = await requireSession('/health/incidents');
  if (!canAccessHealthRecords(session.user.roles ?? [])) {
    return <p className="p-6 text-sm">You need a health role.</p>;
  }
  const rows = await listNurseIncidents();

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
          <h1 className="text-2xl font-semibold tracking-tight">Nurse incidents</h1>
          <p className="mt-1 text-sm text-muted-foreground">Clinic visits and nurse-logged events.</p>
        </div>
        <Button asChild className="min-h-11">
          <Link href="/health/incidents/new">
            <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
            Log visit
          </Link>
        </Button>
      </div>
      <Card>
        <CardContent className="p-6">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">No incidents yet.</p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {rows.map((r) => (
                <li key={r.id} className="py-3 text-sm">
                  <p className="font-medium">{r.category} · {r.severity}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.incidentAt.slice(0, 16).replace('T', ' ')} · student {r.studentId.slice(0, 8)}… · {r.reportedBy}
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
