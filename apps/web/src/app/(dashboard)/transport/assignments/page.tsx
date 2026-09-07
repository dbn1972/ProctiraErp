import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import {
  listDriverAssignments,
  listStudentAssignments,
  listTransportRoutes,
  listTransportVehicles,
} from '@/lib/api/transport';
import { AssignmentForms } from '../_components/assignment-forms';

export const dynamic = 'force-dynamic';

export default async function TransportAssignmentsPage() {
  await requireSession();
  const [drivers, students, routes, vehicles] = await Promise.all([
    listDriverAssignments(),
    listStudentAssignments(),
    listTransportRoutes(),
    listTransportVehicles(),
  ]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Assignments</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Assign drivers to vehicles and students to routes.
        </p>
      </div>

      <AssignmentForms routes={routes} vehicles={vehicles} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Driver assignments</CardTitle>
            <CardDescription>
              {drivers.length === 0
                ? 'No driver assignments yet.'
                : `${drivers.length} assignment${drivers.length === 1 ? '' : 's'}.`}
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
                      Driver {row.driverId.slice(0, 8)} · vehicle {row.vehicleId.slice(0, 8)}
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
                : `${students.length} assignment${students.length === 1 ? '' : 's'}.`}
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
                      Student {row.studentId.slice(0, 8)} · route {row.routeId.slice(0, 8)}
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
