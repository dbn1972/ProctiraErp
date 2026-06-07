/**
 * ScholarshipsRouter — sub-router for the scholarships feature module.
 *
 * Mounted by the federated `RootRouter` at `/app/scholarships/*`. Each
 * sub-route lazy-loads its page component.
 *
 * Sub-routes:
 *   /app/scholarships          → ScholarshipPrograms (program catalog)
 *   /app/scholarships/apply    → ScholarshipApplication (multi-step form)
 *   /app/scholarships/review   → ScholarshipReviewQueue (reviewer queue)
 *   /app/scholarships/disbursements → ScholarshipDisbursementSchedule (payout tracker)
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */

import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

const ScholarshipPrograms = lazy(() => import('./pages/ScholarshipPrograms'));
const ScholarshipApplication = lazy(() => import('./pages/ScholarshipApplication'));
const ScholarshipReviewQueue = lazy(() => import('./pages/ScholarshipReviewQueue'));
const ScholarshipDisbursementSchedule = lazy(() => import('./pages/ScholarshipDisbursementSchedule'));

export default function ScholarshipsRouter() {
  return (
    <Suspense
      fallback={
        <div role="status" aria-label="Loading" className="p-6 text-muted-foreground">
          Loading…
        </div>
      }
    >
      <Routes>
        <Route index element={<ScholarshipPrograms />} />
        <Route path="apply" element={<ScholarshipApplication />} />
        <Route path="review" element={<ScholarshipReviewQueue />} />
        <Route path="disbursements" element={<ScholarshipDisbursementSchedule />} />
      </Routes>
    </Suspense>
  );
}
