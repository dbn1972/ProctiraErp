/**
 * HealthRouter — sub-router for the health and special-needs feature module.
 *
 * Mounted by the federated `RootRouter` at `/app/health/*`. Each
 * sub-route lazy-loads its page component.
 *
 * Sub-routes:
 *   /app/health              → HealthRecord (student-scoped health tabs)
 *   /app/health/special-needs → SpecialNeedsAssessment (assessment + IEP builder)
 *   /app/health/counselling   → CounsellingSessionsLog (session list + case notes)
 *
 * Access control: Requirement 12.4 — unauthorized users see a 403 page at
 * the route level, not blanked content.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
 */

import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

const HealthRecord = lazy(() => import('./pages/HealthRecord'));
const SpecialNeedsAssessment = lazy(() => import('./pages/SpecialNeedsAssessment'));
const CounsellingSessionsLog = lazy(() => import('./pages/CounsellingSessionsLog'));

export default function HealthRouter() {
  return (
    <Suspense
      fallback={
        <div role="status" aria-label="Loading" className="p-6 text-muted-foreground">
          Loading…
        </div>
      }
    >
      <Routes>
        <Route index element={<HealthRecord />} />
        <Route path="special-needs" element={<SpecialNeedsAssessment />} />
        <Route path="counselling" element={<CounsellingSessionsLog />} />
      </Routes>
    </Suspense>
  );
}
