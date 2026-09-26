/**
 * Staff substitutions — list + create (WS1).
 *
 * Route: /staff/substitutions
 */
import Link from 'next/link';
import { ArrowLeft, Users } from 'lucide-react';

import { Button, Card, CardContent } from '@proctira/ui/components';
import { SubstitutionCreateForm } from '@/components/timetable/substitution-create-form';
import { listMeetings, listSubstitutions } from '@/lib/api/timetable';
import { resolveEntityLabel } from '@/lib/entity-label';
import { loadStaffLabelMap } from '@/lib/load-entity-labels';

export const dynamic = 'force-dynamic';

const DAY_LABELS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default async function StaffSubstitutionsPage() {
  const [subsResult, meetingsResult, staffLabels] = await Promise.all([
    listSubstitutions(),
    listMeetings(),
    loadStaffLabelMap(),
  ]);

  const apiError = !subsResult.ok
    ? subsResult.error
    : !meetingsResult.ok
      ? meetingsResult.error
      : null;

  const substitutions = subsResult.ok ? subsResult.data : [];
  const meetings = meetingsResult.ok ? meetingsResult.data : [];

  const meetingOptions = meetings.map((m) => ({
    id: m.id,
    label: `${DAY_LABELS[m.dayOfWeek] ?? m.dayOfWeek} · ${resolveEntityLabel(m.sectionId, {}, 'Section')} · ${resolveEntityLabel(m.staffId, staffLabels, 'Staff')}`,
  }));

  return (
    <section aria-labelledby="substitutions-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/staff">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to staff
        </Link>
      </Button>

      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground"
        >
          <Users className="h-6 w-6" />
        </span>
        <div>
          <h1
            id="substitutions-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Substitutions
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Assign a substitute teacher to a timetable slot. Double-books return HTTP 409.
          </p>
        </div>
      </div>

      {apiError ? (
        <Card>
          <CardContent className="space-y-2 p-6">
            <p className="text-sm font-semibold">Timetable API unavailable</p>
            <p className="text-sm text-muted-foreground" role="alert">
              {apiError}
              {!subsResult.ok &&
                subsResult.code === 'TIMETABLE_SCHEMA_MISSING' &&
                ' Timetable storage is not set up for this environment yet. Contact your administrator.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-4 p-6">
              <h2 className="text-lg font-bold tracking-tight">Assign substitute</h2>
              <SubstitutionCreateForm meetingOptions={meetingOptions} />
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardContent className="p-0">
              {substitutions.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                  No substitutions recorded yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                        <th className="px-4 py-3 font-medium">Date</th>
                        <th className="px-4 py-3 font-medium">Meeting</th>
                        <th className="px-4 py-3 font-medium">Original</th>
                        <th className="px-4 py-3 font-medium">Substitute</th>
                        <th className="px-4 py-3 font-medium">Reason</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {substitutions.map((s) => (
                        <tr key={s.id} className="border-b border-border/60">
                          <td className="px-4 py-3 tabular-nums">{s.substitutionDate}</td>
                          <td className="px-4 py-3 text-xs">
                            {resolveEntityLabel(s.sectionMeetingId, {}, 'Meeting')}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {resolveEntityLabel(s.originalStaffId, staffLabels, 'Staff')}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {resolveEntityLabel(s.substituteStaffId, staffLabels, 'Staff')}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{s.reason ?? '—'}</td>
                          <td className="px-4 py-3 text-xs">{s.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}
