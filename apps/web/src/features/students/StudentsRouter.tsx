/**
 * StudentsRouter — sub-router for the students feature module.
 *
 * Mounted by the federated `RootRouter` at `/app/students/*`. Each sub-route
 * lazy-loads its page component so student screens ship as their own chunks.
 *
 * Sub-routes mirror the prototype router at
 * `School Platform Design/src/app/routes.tsx` (task 60.2).
 */

import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

const StudentsDirectory = lazy(() => import('./pages/StudentsDirectory'));
const StudentProfile = lazy(() => import('./pages/StudentProfile'));
const StudentEnrollment = lazy(() => import('./pages/StudentEnrollment'));
const StudentTransfer = lazy(() => import('./pages/StudentTransfer'));
const StudentRecords = lazy(() => import('./pages/StudentRecords'));
const StudentBulkImport = lazy(() => import('./pages/StudentBulkImport'));

export default function StudentsRouter() {
  return (
    <Suspense
      fallback={
        <div role="status" aria-label="Loading" className="p-6 text-muted-foreground">
          Loading…
        </div>
      }
    >
      <Routes>
        <Route index element={<Navigate to="directory" replace />} />
        <Route path="directory" element={<StudentsDirectory />} />
        <Route path="enroll" element={<StudentEnrollment />} />
        <Route path="import" element={<StudentBulkImport />} />
        <Route path="records" element={<StudentRecords />} />
        <Route path=":id" element={<StudentProfile />} />
        <Route path=":id/transfer" element={<StudentTransfer />} />
      </Routes>
    </Suspense>
  );
}
