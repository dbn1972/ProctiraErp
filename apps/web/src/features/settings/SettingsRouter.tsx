/**
 * SettingsRouter — sub-router for the settings feature module.
 *
 * Mounted by the federated `RootRouter` at `/app/settings/*`. Each sub-route
 * lazy-loads its page component.
 *
 * Sub-routes mirror the prototype router at
 * `School Platform Design/src/app/routes.tsx` (task 60.2).
 */

import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

const SettingsGeneral = lazy(() => import('./pages/SettingsGeneral'));
const RolesPermissions = lazy(() => import('./pages/RolesPermissions'));
const SettingsBranding = lazy(() => import('./pages/SettingsBranding'));
const NotificationPreferences = lazy(() => import('./pages/NotificationPreferences'));
const AuditRouter = lazy(() => import('../audit/AuditRouter'));

export default function SettingsRouter() {
  return (
    <Suspense
      fallback={
        <div role="status" aria-label="Loading" className="p-6 text-muted-foreground">
          Loading…
        </div>
      }
    >
      <Routes>
        <Route index element={<Navigate to="general" replace />} />
        <Route path="general" element={<SettingsGeneral />} />
        <Route path="roles" element={<RolesPermissions />} />
        <Route path="branding" element={<SettingsBranding />} />
        <Route path="notifications" element={<NotificationPreferences />} />
        <Route path="audit/*" element={<AuditRouter />} />
      </Routes>
    </Suspense>
  );
}
