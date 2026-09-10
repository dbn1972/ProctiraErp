/**
 * HomeRouter — sub-router for the dashboards feature module.
 *
 * Mounted by the federated `RootRouter` at `/app/dashboard/*`. The index
 * route delegates to `<RoleRouter>` (Task 52.1) which maps the JWT-derived
 * `useAuth().scope` to the correct dashboard sub-route. Each sub-route
 * lazy-loads its page component so dashboard variants ship as their own
 * chunks.
 *
 * Sub-routes mirror the prototype router at
 * `School Platform Design/src/app/routes.tsx` (task 60.2) and the design
 * matrix in §G.
 */

import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

import RoleRouter from './RoleRouter';

const SchoolDashboard = lazy(() => import('./pages/SchoolDashboard'));
const CountryDashboard = lazy(() => import('./pages/CountryDashboard'));
const StateDashboard = lazy(() => import('./pages/StateDashboard'));
const BoardAdminDashboard = lazy(() => import('./pages/BoardAdminDashboard'));
const TeacherDashboard = lazy(() => import('./pages/TeacherDashboard'));
const MeDashboard = lazy(() => import('./pages/MeDashboard'));
const BoardComparisonDashboard = lazy(() => import('./pages/BoardComparisonDashboard'));
const CrossBoardTransferDashboard = lazy(() => import('./pages/CrossBoardTransferDashboard'));

export default function HomeRouter() {
  return (
    <Suspense
      fallback={
        <div role="status" aria-label="Loading" className="p-6 text-muted-foreground">
          Loading…
        </div>
      }
    >
      <Routes>
        {/*
         * Index → role router. RoleRouter reads `useAuth().scope` and
         * redirects to the correct sub-route per Design §Q. Server-side
         * RBAC enforces actual data access; this is purely a default
         * landing surface.
         */}
        <Route index element={<RoleRouter />} />
        <Route path="country" element={<CountryDashboard />} />
        <Route path="state" element={<StateDashboard />} />
        <Route path="board-admin" element={<BoardAdminDashboard />} />
        <Route path="school" element={<SchoolDashboard />} />
        <Route path="teacher" element={<TeacherDashboard />} />
        <Route path="me" element={<MeDashboard />} />
        <Route path="board-comparison" element={<BoardComparisonDashboard />} />
        <Route path="cross-board-transfer" element={<CrossBoardTransferDashboard />} />
        <Route path="cross-board-transfer/:transferId" element={<CrossBoardTransferDashboard />} />
      </Routes>
    </Suspense>
  );
}
