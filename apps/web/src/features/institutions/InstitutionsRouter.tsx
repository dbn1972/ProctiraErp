/**
 * InstitutionsRouter — sub-router for the institutions feature module.
 *
 * Mounted by the federated `RootRouter` at `/app/institutions/*`. Each
 * sub-route lazy-loads its page component so institution screens ship as
 * their own chunks.
 *
 * Sub-routes mirror the prototype router at
 * `School Platform Design/src/app/routes.tsx` (task 60.2).
 */

import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

const InstitutionsList = lazy(() => import('./pages/InstitutionsList'));
const InstitutionDetail = lazy(() => import('./pages/InstitutionDetail'));
const InstitutionForm = lazy(() => import('./pages/InstitutionForm'));

export default function InstitutionsRouter() {
  return (
    <Suspense
      fallback={
        <div role="status" aria-label="Loading" className="p-6 text-muted-foreground">
          Loading…
        </div>
      }
    >
      <Routes>
        <Route index element={<Navigate to="list" replace />} />
        <Route path="list" element={<InstitutionsList />} />
        <Route path="new" element={<InstitutionForm />} />
        <Route path=":id" element={<InstitutionDetail />} />
        <Route path=":id/edit" element={<InstitutionForm />} />
      </Routes>
    </Suspense>
  );
}
