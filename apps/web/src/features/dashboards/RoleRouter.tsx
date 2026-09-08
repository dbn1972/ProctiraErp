/**
 * RoleRouter — chooses the default dashboard surface for the current user
 * (Task 52.1 / Requirement 40.9 / Design §G, §Q).
 *
 * Mounted at the index of the `/app/dashboard` route group by `HomeRouter`.
 * It reads `useAuth().user.scope` and `useAuth().user.roles`, asks
 * `selectDefaultDashboardRoute()` for the matching sub-route, and emits a
 * `<Navigate replace>` to that route. The actual dashboard pages live at
 * the sibling routes (`country`, `state`, `board-admin`, `school`,
 * `teacher`, `me`) so this component never renders dashboard markup of its
 * own.
 *
 * Server-side RBAC remains the authoritative gate (Design §Q). This
 * component only picks the *default* route; deep links continue to work,
 * and tampered tokens are caught at the data layer.
 */

import { Navigate } from 'react-router-dom';

import { useAuth } from '@/providers/AuthProvider';

import {
  FALLBACK_ROUTE,
  selectDefaultDashboardRoute,
  type RoleRouterScope,
} from './selectDefaultDashboardRoute';

export default function RoleRouter() {
  const { user } = useAuth();

  // The unauthenticated case is normally caught by `<RequireAuth>` further
  // up the tree, but if it reaches us we still surface the lowest-privilege
  // dashboard rather than crashing — server-side RBAC will enforce the
  // actual data fence.
  const scope: RoleRouterScope | null = user?.scope ? { level: user.scope.level } : null;
  const roles = user?.roles ?? [];

  if (!user) {
    return <Navigate to={FALLBACK_ROUTE} replace />;
  }

  const target = selectDefaultDashboardRoute({ scope, roles });
  return <Navigate to={target} replace />;
}
