/**
 * Institution master schedule — sections list/create + publish (WS2).
 *
 * Route: /institutions/[id]/schedule
 */
import Link from 'next/link';

import { Card, CardContent } from '@proctira/ui/components';

import { SectionCreateForm } from '@/components/timetable/section-create-form';
import { SectionPublishControls } from '@/components/timetable/section-roster-controls';
import { listAcademicPeriods } from '@/lib/institutions/api';
import { listRooms, listSections } from '@/lib/api/timetable';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

export default async function InstitutionSchedulePage({ params }: PageProps) {
  const institutionId = params.id;

  let academicPeriodId = '';
  try {
    const periods = await listAcademicPeriods();
    academicPeriodId =
      periods.find((p) => p.status === 'active')?.id ?? periods[0]?.id ?? '';
  } catch {
    academicPeriodId = '';
  }

  const [sectionsResult, roomsResult] = await Promise.all([
    listSections({
      institutionId,
      academicPeriodId: academicPeriodId || undefined,
    }),
    listRooms({ institutionId }),
  ]);

  const apiError = !sectionsResult.ok
    ? sectionsResult.error
    : !roomsResult.ok
      ? roomsResult.error
      : null;

  const sections = sectionsResult.ok ? sectionsResult.data : [];
  const rooms = roomsResult.ok ? roomsResult.data : [];
  const roomOptions = rooms.map((r) => ({
    id: r.id,
    label: `${r.code} · ${r.name}`,
  }));
  const roomLabel = new Map(roomOptions.map((r) => [r.id, r.label]));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-foreground">
          Master schedule
        </h2>
        <p className="text-sm text-muted-foreground">
          Course sections, room assignment, rostering, and draft → published
          workflow. Room and teacher clashes return HTTP 409.
        </p>
      </div>

      {apiError ? (
        <Card>
          <CardContent className="space-y-2 p-6">
            <p className="text-sm font-semibold">Schedule API unavailable</p>
            <p className="text-sm text-muted-foreground" role="alert">
              {apiError}
              {sectionsResult.ok === false &&
                sectionsResult.code === 'TIMETABLE_SCHEMA_MISSING' &&
                ' — apply db/sql/003_sis_timetable_schedule_schema.sql.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-4 p-6">
              <h3 className="text-base font-semibold">Create section</h3>
              <SectionCreateForm
                institutionId={institutionId}
                academicPeriodId={academicPeriodId}
                roomOptions={roomOptions}
              />
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardContent className="p-0">
              {sections.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                  No sections yet. Create a draft section, add meetings on the
                  Timetable tab, then publish.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[44rem] text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                        <th className="px-4 py-3 font-medium">Code</th>
                        <th className="px-4 py-3 font-medium">Name</th>
                        <th className="px-4 py-3 font-medium">Room</th>
                        <th className="px-4 py-3 font-medium">Capacity</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sections.map((section) => (
                        <tr key={section.id} className="border-b border-border/60">
                          <td className="px-4 py-3 font-mono text-xs">{section.code}</td>
                          <td className="px-4 py-3">
                            <Link
                              href={`/institutions/${institutionId}/schedule/${section.id}`}
                              className="font-medium text-foreground underline-offset-4 hover:underline"
                            >
                              {section.name}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {section.defaultRoomId
                              ? roomLabel.get(section.defaultRoomId) ??
                                section.defaultRoomId.slice(0, 8)
                              : '—'}
                          </td>
                          <td className="px-4 py-3 tabular-nums">{section.capacity}</td>
                          <td className="px-4 py-3 text-xs">{section.status}</td>
                          <td className="px-4 py-3">
                            <SectionPublishControls
                              institutionId={institutionId}
                              sectionId={section.id}
                              status={section.status}
                            />
                          </td>
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
    </div>
  );
}
