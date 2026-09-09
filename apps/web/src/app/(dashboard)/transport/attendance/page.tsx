import { requireSession } from '@/lib/auth/server';
import { listStudentAssignments, listTransportRoutes } from '@/lib/api/transport';
import { getTripAttendance } from '@/lib/transport/api';
import { AttendancePanel } from '../_components/attendance-panel';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ routeId?: string; tripDate?: string; direction?: string }>;
}

export default async function TransportAttendancePage(props: PageProps) {
  await requireSession();
  const query = await props.searchParams;
  const [routes, assignments] = await Promise.all([
    listTransportRoutes(),
    listStudentAssignments(),
  ]);
  const direction = query.direction === 'drop' ? 'drop' : query.direction === 'pickup' ? 'pickup' : null;
  const trip =
    query.routeId && query.tripDate && direction
      ? await getTripAttendance({
          routeId: query.routeId,
          tripDate: query.tripDate,
          direction,
        })
      : null;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bus attendance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Mark boarded, alighted, or absent for a trip. Counts summarise the current trip.
        </p>
      </div>
      <AttendancePanel routes={routes} assignments={assignments} trip={trip} />
    </div>
  );
}
