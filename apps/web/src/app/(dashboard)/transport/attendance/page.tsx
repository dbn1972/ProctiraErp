import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { hasDashboardDomainRouteAccess } from '@/lib/auth/domain-route-access';
import { listStudentAssignments, listTransportRoutes, listTripRiders } from '@/lib/api/transport';
import { loadStudentOptions } from '@/lib/load-entity-labels';
import { toLabelMap } from '@/lib/entity-label';
import { getTripAttendance } from '@/lib/transport/api';
import { AttendancePanel } from '../_components/attendance-panel';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ routeId?: string; tripDate?: string; direction?: string }>;
}

export default async function TransportAttendancePage(props: PageProps) {
  // T-D1: check before any transport or student-directory read.
  if (!(await hasDashboardDomainRouteAccess('transport', '/transport'))) {
    return <RouteAccessDenied />;
  }
  const query = await props.searchParams;
  const direction: 'pickup' | 'drop' | null =
    query.direction === 'drop' ? 'drop' : query.direction === 'pickup' ? 'pickup' : null;
  const tripQuery =
    query.routeId && query.tripDate && direction
      ? { routeId: query.routeId, tripDate: query.tripDate, direction }
      : null;
  // PRC-M130: with a trip loaded, offer only that route's riders on the trip date.
  const [routes, assignments, students, trip] = await Promise.all([
    listTransportRoutes(),
    tripQuery ? listTripRiders(tripQuery) : listStudentAssignments(),
    loadStudentOptions(),
    tripQuery ? getTripAttendance(tripQuery) : Promise.resolve(null),
  ]);
  const studentLabels = Object.fromEntries(toLabelMap(students));
  const routeLabels = Object.fromEntries(routes.map((route) => [route.id, route.name]));

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bus attendance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Mark boarded, alighted, or absent for a trip. Counts summarise the current trip.
        </p>
      </div>
      <AttendancePanel
        routes={routes}
        assignments={assignments}
        trip={trip}
        tripQuery={tripQuery}
        studentLabels={studentLabels}
        routeLabels={routeLabels}
      />
    </div>
  );
}
