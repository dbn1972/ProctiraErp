/**
 * AssessmentRouter — sub-router for the assessment feature module.
 *
 * Mounted by the federated `RootRouter` at `/app/assessment/*`. Each
 * sub-route lazy-loads its page component.
 *
 * Sub-routes mirror the prototype router at
 * `School Platform Design/src/app/routes.tsx` (task 60.2).
 */

import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

const AssessmentResultsEntry = lazy(() => import('./pages/AssessmentResultsEntry'));
const AssessmentReportCard = lazy(() => import('./pages/AssessmentReportCard'));
const AssessmentSchemeConfig = lazy(() => import('./pages/AssessmentSchemeConfig'));

export default function AssessmentRouter() {
  return (
    <Suspense
      fallback={
        <div role="status" aria-label="Loading" className="p-6 text-muted-foreground">
          Loading…
        </div>
      }
    >
      <Routes>
        <Route index element={<Navigate to="results-entry" replace />} />
        <Route path="results-entry" element={<AssessmentResultsEntry />} />
        <Route path="report-cards" element={<AssessmentReportCard />} />
        <Route path="schemes" element={<AssessmentSchemeConfig />} />
      </Routes>
    </Suspense>
  );
}
