/**
 * AttendanceRouter — sub-router for the attendance feature module.
 *
 * Mounted by the federated `RootRouter` at `/app/attendance/*`. Each
 * sub-route lazy-loads its page component.
 *
 * Sub-routes mirror the prototype router at
 * `School Platform Design/src/app/routes.tsx` (task 60.2).
 */

import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

const AttendanceMarking = lazy(() => import('./pages/AttendanceMarking'));
const AttendanceDashboard = lazy(() => import('./pages/AttendanceDashboard'));
const AttendanceCalendar = lazy(() => import('./pages/AttendanceCalendar'));

export default function AttendanceRouter() {
  return (
    <Suspense
      fallback={
        <div role="status" aria-label="Loading" className="p-6 text-muted-foreground">
          Loading…
        </div>
      }
    >
      <Routes>
        <Route index element={<AttendanceMarking />} />
        <Route path="dashboard" element={<AttendanceDashboard />} />
        <Route path="calendar/:studentId" element={<AttendanceCalendar />} />
      </Routes>
    </Suspense>
  );
}
