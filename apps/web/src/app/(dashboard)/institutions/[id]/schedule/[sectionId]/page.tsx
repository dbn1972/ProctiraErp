/**
 * Section roster + publish detail — Academics redesign (WS2).
 *
 * Route: /institutions/[id]/schedule/[sectionId]
 */
import Link from 'next/link';

import { Card, CardContent } from '@proctira/ui/components';

import {
  SectionEnrollForm,
  SectionPublishControls,
  WithdrawStudentButton,
} from '@/components/timetable/section-roster-controls';
import { getSection } from '@/lib/api/timetable';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string; sectionId: string };
}

export default async function SectionRosterPage({ params }: PageProps) {
  const institutionId = params.id;
  const sectionResult = await getSection(params.sectionId);

  if (!sectionResult.ok) {
    return (
      <div className="space-y-4">
        <Link
          href={`/institutions/${institutionId}/schedule`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Master schedule
        </Link>
        <Card>
          <CardContent className="space-y-2 p-6">
            <p className="text-sm font-semibold">Section unavailable</p>
            <p className="text-sm text-muted-foreground" role="alert">
              {sectionResult.error}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const section = sectionResult.data;
  const enrollments = section.enrollments ?? [];
  const meetings = section.meetings ?? [];
  const active = enrollments.filter((e) => e.status === 'ENROLLED');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/institutions/${institutionId}/schedule`}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Master schedule
          </Link>
          <h2 className="mt-2 text-lg font-bold tracking-tight text-foreground">
            {section.name}
          </h2>
          <p className="text-sm text-muted-foreground">
            {section.code} · {section.status}
            {section.publishedAt ? ` · published ${section.publishedAt.slice(0, 10)}` : ''}
          </p>
        </div>
        <SectionPublishControls
          institutionId={institutionId}
          sectionId={section.id}
          status={section.status}
        />
      </div>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h3 className="text-base font-semibold">Meetings</h3>
          {meetings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No meetings yet. Add them on the{' '}
              <Link
                href={`/institutions/${institutionId}/timetable`}
                className="underline underline-offset-4"
              >
                Timetable
              </Link>{' '}
              tab before publishing.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {meetings.map((m) => (
                <li key={m.id} className="font-mono text-xs text-muted-foreground">
                  day {m.dayOfWeek} · period {m.periodId.slice(0, 8)}… · room{' '}
                  {m.roomId?.slice(0, 8) ?? '—'} · staff {m.staffId.slice(0, 8)}…
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-semibold">Roster</h3>
            <p className="text-xs text-muted-foreground">
              {active.length} / {section.capacity} enrolled
            </p>
          </div>
          <SectionEnrollForm institutionId={institutionId} sectionId={section.id} />
          {enrollments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No enrollments yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 font-medium">Student</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2 font-medium">Enrolled</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {enrollments.map((e) => (
                    <tr key={e.id} className="border-b border-border/60">
                      <td className="py-2 font-mono text-xs">{e.studentId}</td>
                      <td className="py-2 text-xs">{e.status}</td>
                      <td className="py-2 text-xs">{e.enrolledAt}</td>
                      <td className="py-2 text-right">
                        {e.status === 'ENROLLED' && (
                          <WithdrawStudentButton
                            institutionId={institutionId}
                            sectionId={section.id}
                            studentId={e.studentId}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
