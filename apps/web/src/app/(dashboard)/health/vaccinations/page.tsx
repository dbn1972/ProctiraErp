/**
 * Health vaccinations register (Wave 10 Option B).
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, Plus } from 'lucide-react';

import { Button, Card, CardContent } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { ListLoadFailure } from '@/components/route-state/list-load-failure';
import {
  canAccessHealthRecords,
  canAccessTenantWideHealthLists,
  listVaccinationsResult,
} from '@/lib/api/health';
import { TenantWideHealthListDenied } from '@/lib/auth/health-route-guards';
import { personDisplayName } from '@/lib/entity-label';
import { loadStudentLabelMap } from '@/lib/load-entity-labels';
import { createUnknownStudentLabeler } from '../_components/unknown-student-label';

export const dynamic = 'force-dynamic';

/** Rows rendered; the register says when more exist (HL-O5). */
const REGISTER_ROW_LIMIT = 100;

export default async function HealthVaccinationsPage() {
  const session = await requireSession('/health/vaccinations');
  if (!canAccessHealthRecords(session.user.roles ?? [])) {
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        You need a health role to view vaccinations.
      </p>
    );
  }
  // UATENV-D26: the register is tenant-wide; the health service refuses a
  // school-bound nurse or counsellor, so they get the access card, not a 403 list.
  if (!canAccessTenantWideHealthLists(session.user.roles ?? [])) {
    return <TenantWideHealthListDenied />;
  }
  const result = await listVaccinationsResult();
  if (!result.ok) {
    // HL-O1: a refused or failed read is not "No vaccinations recorded yet", and the
    // create button is not offered to a caller the register refused.
    return (
      <div className="space-y-6 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Vaccinations</h1>
        <ListLoadFailure
          kind={result.kind}
          status={result.status}
          returnTo="/health/vaccinations"
        />
      </div>
    );
  }
  const rows = result.items;
  const t = await getTranslations('health');
  const unknownStudent = t('unknownStudent');
  // HN-F1 / PRC-M088: resolve every shown row's student by id; an unresolved one gets the
  // localized fallback (HN-R6), never an id fragment, and a unique link name (HN-R5).
  const studentLabels = await loadStudentLabelMap(
    rows.slice(0, REGISTER_ROW_LIMIT).map((r) => r.studentId),
  );
  const unknownLink = createUnknownStudentLabeler(unknownStudent);
  const shown = rows.slice(0, REGISTER_ROW_LIMIT).map((r) => {
    const studentName = personDisplayName(studentLabels.get(r.studentId), '', unknownStudent);
    const detail = [
      r.vaccineName,
      r.doseNumber != null ? `dose ${r.doseNumber}` : '',
      r.dateAdministered,
    ]
      .filter(Boolean)
      .join(' · ');
    return { ...r, studentName, linkLabel: unknownLink(studentName, detail) };
  });

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
              {shown.map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-2 py-3">
                  <div>
                    <Link
                      href={`/health/${r.studentId}`}
                      className="font-medium hover:underline"
                      aria-label={r.linkLabel}
                    >
                      {r.studentName}
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
          {rows.length > shown.length ? (
            // HL-O5: the register used to cut at 100 rows without saying so.
            <p className="mt-4 text-xs text-muted-foreground" role="status">
              Showing {shown.length} of {rows.length} vaccinations.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
