/**
 * ExaminationsRouter — sub-router for the examinations feature module.
 *
 * Mounted by the federated `RootRouter` at `/app/examinations/*`. Each
 * sub-route lazy-loads its page component.
 *
 * Sub-routes mirror the prototype router at
 * `School Platform Design/src/app/routes.tsx` (task 60.2).
 */

import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

const ExaminationSetup = lazy(() => import('./pages/ExaminationSetup'));
const ExaminationCandidates = lazy(() => import('./pages/ExaminationCandidates'));
const ExaminationResults = lazy(() => import('./pages/ExaminationResults'));

export default function ExaminationsRouter() {
  return (
    <Suspense
      fallback={
        <div role="status" aria-label="Loading" className="p-6 text-muted-foreground">
          Loading…
        </div>
      }
    >
      <Routes>
        <Route index element={<ExaminationSetup />} />
        <Route path="candidates" element={<ExaminationCandidates />} />
        <Route path="results" element={<ExaminationResults />} />
      </Routes>
    </Suspense>
  );
}
