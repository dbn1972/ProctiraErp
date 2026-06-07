/**
 * EtlRouter — sub-router for the ETL pipeline builder feature module.
 *
 * Mounted by the federated `RootRouter` at `/app/etl/*`. Each
 * sub-route lazy-loads its page component.
 *
 * Task 60A.6: ETL pipeline builder UI.
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6
 */

import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

const PipelineList = lazy(() => import('./pages/PipelineList'));
const PipelineBuilder = lazy(() => import('./pages/PipelineBuilder'));
const ExecutionLog = lazy(() => import('./pages/ExecutionLog'));

export default function EtlRouter() {
  return (
    <Suspense
      fallback={
        <div role="status" aria-label="Loading" className="p-6 text-muted-foreground">
          Loading…
        </div>
      }
    >
      <Routes>
        <Route index element={<Navigate to="pipelines" replace />} />
        <Route path="pipelines" element={<PipelineList />} />
        <Route path="pipelines/new" element={<PipelineBuilder />} />
        <Route path="pipelines/:pipelineId/edit" element={<PipelineBuilder />} />
        <Route path="pipelines/:pipelineId/logs" element={<ExecutionLog />} />
        <Route path="pipelines/:pipelineId/logs/:executionId" element={<ExecutionLog />} />
      </Routes>
    </Suspense>
  );
}
