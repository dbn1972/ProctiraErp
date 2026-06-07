/**
 * AuditRouter — sub-router for the audit trail viewer feature (Task 60A.10).
 *
 * Mounted by the SettingsRouter at `/app/settings/audit/*`. Provides:
 *   - Filterable list of audit entries (by entity type, user, date range, operation)
 *   - Detail view showing before/after values for each change
 *
 * Validates: Requirements 21.1, 21.2, 21.3, 21.4
 */

import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

const AuditViewer = lazy(() => import('./pages/AuditViewer'));
const AuditDetailPage = lazy(() => import('./pages/AuditDetailPage'));

export default function AuditRouter() {
  return (
    <Suspense
      fallback={
        <div role="status" aria-label="Loading" className="p-6 text-muted-foreground">
          Loading…
        </div>
      }
    >
      <Routes>
        <Route index element={<AuditViewer />} />
        <Route path=":entryId" element={<AuditDetailPage />} />
      </Routes>
    </Suspense>
  );
}
