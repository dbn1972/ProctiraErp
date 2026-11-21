import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, Plus } from 'lucide-react';

import { Button, Card, CardContent } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { ListLoadFailure } from '@/components/route-state/list-load-failure';
import { canAccessHealthRecords, listNurseIncidentsResult } from '@/lib/api/health';
import { personDisplayName } from '@/lib/entity-label';
import { loadStudentLabelMap } from '@/lib/load-entity-labels';

export const dynamic = 'force-dynamic';

export default async function HealthIncidentsPage() {
  const session = await requireSession('/health/incidents');
  if (!canAccessHealthRecords(session.user.roles ?? [])) {
    return <p className="p-6 text-sm">You need a health role.</p>;
  }
  const result = await listNurseIncidentsResult();
  if (!result.ok) {
    // HL-O1: a refused or failed read is not "No incidents yet", and "Log visit" is not
    // offered to a caller the register refused.
    return (
      <div className="space-y-6 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Nurse incidents</h1>
        <ListLoadFailure kind={result.kind} status={result.status} returnTo="/health/incidents" />
      </div>
    );
  }
  const t = await getTranslations('health');
  // HN-F1 / PRC-M088: resolve each row's student by id; an unresolved one gets the
  // localized fallback (HN-R6), never an id fragment.
  const studentLabels = await loadStudentLabelMap(result.items.map((r) => r.studentId));
  const rows = result.items.map((r) => ({
    ...r,
    studentName: personDisplayName(studentLabels.get(r.studentId), '', t('unknownStudent')),
  }));

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
          <p className="mt-1 text-sm text-muted-foreground">
            Clinic visits and nurse-logged events.
          </p>
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
            <p className="text-sm text-muted-foreground" role="status">
              No incidents yet.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {rows.map((r) => (
                <li key={r.id} className="py-3 text-sm">
                  <p className="font-medium">
                    {r.category} · {r.severity}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.incidentAt.slice(0, 16).replace('T', ' ')} · {r.studentName} · {r.reportedBy}
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
