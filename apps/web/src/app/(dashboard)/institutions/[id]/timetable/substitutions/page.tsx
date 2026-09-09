/**
 * Institution substitution desk (G-917).
 *
 * Route: /institutions/[id]/timetable/substitutions
 */
import Link from 'next/link';

import { Button, Card, CardContent } from '@proctira/ui/components';
import { SubstitutionCreateForm } from '@/components/timetable/substitution-create-form';
import { TeacherAbsenceForm } from '@/components/timetable/teacher-absence-form';
import { formatPersonLabel } from '@/lib/entity-label';
import { listStaff } from '@/lib/api/staff';
import { listMeetings, listSubstitutions } from '@/lib/api/timetable';

export const dynamic = 'force-dynamic';

const DAY_LABELS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TimetableSubstitutionsPage(props: PageProps) {
  const params = await props.params;
  const institutionId = params.id;

  const [subsResult, meetingsResult, staffResult] = await Promise.all([
    listSubstitutions({ institutionId }),
    listMeetings({ institutionId }),
    listStaff({ pageSize: 100 }).catch(() => ({
      data: [],
      meta: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 },
    })),
  ]);

  const substitutions = subsResult.ok ? subsResult.data : [];
  const meetings = meetingsResult.ok ? meetingsResult.data : [];
  const staffOptions = (staffResult.data ?? []).map((s) => ({
    id: s.id,
    label: formatPersonLabel(s.firstName, s.lastName, s.position),
  }));
  const meetingOptions = meetings.map((m) => ({
    id: m.id,
    label: `${DAY_LABELS[m.dayOfWeek] ?? m.dayOfWeek} · staff ${m.staffId.slice(0, 8)}…`,
  }));

  return (
    <div className="space-y-4" data-testid="timetable-substitutions-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground">Substitutions</h2>
          <p className="text-sm text-muted-foreground">
            Mark a teacher absent for a date, review affected periods, then assign a substitute.
            Overlapping assignments are blocked with a clear error.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/institutions/${institutionId}/timetable`}>Back to grid</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-4 p-6">
          <h3 className="text-base font-semibold">Mark teacher absent</h3>
          <TeacherAbsenceForm institutionId={institutionId} staffOptions={staffOptions} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-6">
          <h3 className="text-base font-semibold">Assign substitute</h3>
          <SubstitutionCreateForm meetingOptions={meetingOptions} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h3 className="text-base font-semibold">Recent substitutions</h3>
          {substitutions.length === 0 ? (
            <p className="text-sm text-muted-foreground">None recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {substitutions.map((s) => (
                <li key={s.id} className="py-2 text-sm">
                  {s.substitutionDate} · meeting {s.sectionMeetingId.slice(0, 8)}… →{' '}
                  {s.substituteStaffId.slice(0, 8)}…
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
