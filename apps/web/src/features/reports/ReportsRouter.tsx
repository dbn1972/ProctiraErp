/**
 * ReportsRouter — sub-router for the reports feature module.
 *
 * Mounted by the federated `RootRouter` at `/app/reports/*`. Each sub-route
 * lazy-loads its page component.
 */

import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

const ReportBuilder = lazy(() => import('./pages/ReportBuilder'));

export default function ReportsRouter() {
  return (
    <Suspense
      fallback={
        <div role="status" aria-label="Loading" className="p-6 text-muted-foreground">
          Loading…
        </div>
      }
    >
      <Routes>
        <Route index element={<Navigate to="builder" replace />} />
        <Route path="builder" element={<ReportBuilder />} />
      </Routes>
    </Suspense>
  );
}
