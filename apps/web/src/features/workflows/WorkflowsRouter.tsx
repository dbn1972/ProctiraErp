/**
 * WorkflowsRouter — sub-router for the workflows feature module.
 *
 * Mounted by the federated `RootRouter` at `/app/workflows/*`. Each
 * sub-route lazy-loads its page component.
 *
 * Task 60A.1: Workflow inbox and detail screens.
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
 */

import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

const WorkflowInbox = lazy(() => import('./pages/WorkflowInbox'));
const WorkflowDetail = lazy(() => import('./pages/WorkflowDetail'));

export default function WorkflowsRouter() {
  return (
    <Suspense
      fallback={
        <div role="status" aria-label="Loading" className="p-6 text-muted-foreground">
          Loading…
        </div>
      }
    >
      <Routes>
        <Route index element={<Navigate to="inbox" replace />} />
        <Route path="inbox" element={<WorkflowInbox />} />
        <Route path=":instanceId" element={<WorkflowDetail />} />
      </Routes>
    </Suspense>
  );
}
