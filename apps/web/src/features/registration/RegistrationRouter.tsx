/**
 * RegistrationRouter — sub-router for the public registration portal.
 *
 * Mounted by the federated `RootRouter` at `/registration/*`. Each sub-route
 * lazy-loads its page component.
 *
 * Sub-routes mirror the prototype router at
 * `School Platform Design/src/app/routes.tsx` (task 60.2).
 */

import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

const RegistrationLanding = lazy(() => import('./pages/RegistrationLanding'));
const RegistrationForm = lazy(() => import('./pages/RegistrationForm'));
const ApplicationTracking = lazy(() => import('./pages/ApplicationTracking'));
const SchoolFinder = lazy(() => import('./pages/SchoolFinder'));

export default function RegistrationRouter() {
  return (
    <Suspense
      fallback={
        <div role="status" aria-label="Loading" className="p-6 text-muted-foreground">
          Loading…
        </div>
      }
    >
      <Routes>
        <Route index element={<Navigate to="landing" replace />} />
        <Route path="landing" element={<RegistrationLanding />} />
        <Route path="form" element={<RegistrationForm />} />
        <Route path="tracking" element={<ApplicationTracking />} />
        <Route path="school-finder" element={<SchoolFinder />} />
      </Routes>
    </Suspense>
  );
}
