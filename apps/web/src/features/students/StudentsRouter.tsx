/**
 * StudentsRouter — sub-router for the students feature module.
 *
 * Mounted by the federated `RootRouter` at `/app/students/*`. Enrollment and
 * transfer writes live on the App Router; federated paths redirect so CTAs
 * never land on placeholders (P0-04).
 */

import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';

const StudentsDirectory = lazy(() => import('./pages/StudentsDirectory'));
const StudentEnrollment = lazy(() => import('./pages/StudentEnrollment'));
const StudentTransfer = lazy(() => import('./pages/StudentTransfer'));
const StudentRecords = lazy(() => import('./pages/StudentRecords'));
const StudentBulkImport = lazy(() => import('./pages/StudentBulkImport'));

function RedirectTo({ href }: { href: string }) {
  if (typeof window !== 'undefined') window.location.replace(href);
  return (
    <div role="status" aria-live="polite" className="p-6 text-muted-foreground">
      <a href={href}>{href}</a>
    </div>
  );
}

function ProfileRedirect() {
  const { id } = useParams<{ id: string }>();
  return <RedirectTo href={id ? `/students/${id}` : '/students'} />;
}

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
        <Route path="new" element={<RedirectTo href="/students/new" />} />
        <Route path="import" element={<StudentBulkImport />} />
        <Route path="records" element={<StudentRecords />} />
        <Route path=":id/transfer" element={<StudentTransfer />} />
        <Route path=":id/enroll" element={<ProfileEnrollRedirect />} />
        <Route path=":id" element={<ProfileRedirect />} />
      </Routes>
    </Suspense>
  );
}

function ProfileEnrollRedirect() {
  const { id } = useParams<{ id: string }>();
  return <RedirectTo href={id ? `/students/${id}/enroll` : '/students/enroll'} />;
}
