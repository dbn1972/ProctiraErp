/**
 * StaffRouter — sub-router for the staff feature module.
 *
 * Mounted by the federated `RootRouter` at `/app/staff/*`. Each sub-route
 * lazy-loads its page component.
 *
 * Sub-routes mirror the prototype router at
 * `School Platform Design/src/app/routes.tsx` (task 60.2).
 */

import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

const StaffDirectory = lazy(() => import('./pages/StaffDirectory'));
const StaffProfile = lazy(() => import('./pages/StaffProfile'));

export default function StaffRouter() {
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
        <Route path="directory" element={<StaffDirectory />} />
        <Route path=":id" element={<StaffProfile />} />
      </Routes>
    </Suspense>
  );
}
