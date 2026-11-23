import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { hasDashboardDomainRouteAccess } from '@/lib/auth/domain-route-access';
import {
  listDriverAssignmentsWithTotal,
  listStudentAssignmentsWithTotal,
  listTransportRoutes,
  listTransportVehicles,
} from '@/lib/api/transport';
import { resolveEntityLabel } from '@/lib/entity-label';
import { loadStaffOptions, loadStudentOptions } from '@/lib/load-entity-labels';
import { listAllStops } from '@/lib/transport/api';
import { AssignmentForms } from '../_components/assignment-forms';
import { listCountCopy } from '../_components/list-count';

export const dynamic = 'force-dynamic';

const ASSIGNMENT_NOUN = { one: 'assignment', many: 'assignments' };

export default async function TransportAssignmentsPage() {
  // T-D1: check before any transport or student-directory read.
  if (!(await hasDashboardDomainRouteAccess('transport', '/transport'))) {
    return <RouteAccessDenied />;
  }
  const [driverList, studentList, routes, vehicles, stops, studentOptions, staffOptions] =
    await Promise.all([
      listDriverAssignmentsWithTotal(),
      listStudentAssignmentsWithTotal(),
      listTransportRoutes(),
      listTransportVehicles(),
      listAllStops(),
      loadStudentOptions(),
      loadStaffOptions(),
    ]);
  const drivers = driverList.items;
  const students = studentList.items;
  const studentLabels = new Map(studentOptions.map((option) => [option.id, option.label]));
  const staffLabels = new Map(staffOptions.map((option) => [option.id, option.label]));
  const routeLabels = new Map(routes.map((route) => [route.id, route.name]));
  const vehicleLabels = new Map(
    vehicles.map((vehicle) => [vehicle.id, vehicle.registrationNumber]),
  );

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Assignments</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Assign drivers to vehicles and students to routes.
        </p>
      </div>

      <AssignmentForms
        routes={routes}
        vehicles={vehicles}
        stops={stops}
        studentOptions={studentOptions}
        staffOptions={staffOptions}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Driver assignments</CardTitle>
            <CardDescription>
              {drivers.length === 0
                ? 'No driver assignments yet.'
                : listCountCopy(driverList, ASSIGNMENT_NOUN)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {drivers.length === 0 ? (
              <p className="text-sm text-muted-foreground" role="status">
                Empty driver list.
              </p>
            ) : (
              <ul className="divide-y divide-border" role="list">
                {drivers.map((row) => (
                  <li key={row.id} className="py-3 first:pt-0 last:pb-0">
                    <p className="text-sm font-medium text-foreground">
                      {resolveEntityLabel(row.driverId, staffLabels, 'Driver')} ·{' '}
                      {resolveEntityLabel(row.vehicleId, vehicleLabels, 'Vehicle')}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      from {row.startDate}
                      {row.endDate ? ` to ${row.endDate}` : ''} ·{' '}
                      {row.isActive ? 'active' : 'inactive'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Student assignments</CardTitle>
            <CardDescription>
              {students.length === 0
                ? 'No student assignments yet.'
                : listCountCopy(studentList, ASSIGNMENT_NOUN)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {students.length === 0 ? (
              <p className="text-sm text-muted-foreground" role="status">
                Empty student list.
              </p>
            ) : (
              <ul className="divide-y divide-border" role="list">
                {students.map((row) => (
                  <li key={row.id} className="py-3 first:pt-0 last:pb-0">
                    <p className="text-sm font-medium text-foreground">
                      {resolveEntityLabel(row.studentId, studentLabels, 'Student')} ·{' '}
                      {resolveEntityLabel(row.routeId, routeLabels, 'Route')}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      from {row.startDate}
                      {row.endDate ? ` to ${row.endDate}` : ''} ·{' '}
                      {row.isActive ? 'active' : 'inactive'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
