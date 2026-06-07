/**
 * @proctira/backend-admin-dashboard - Admin monitoring and management
 *
 * Provides scalability monitoring endpoints for:
 * - Cache metrics (hits, misses, errors, hit rate)
 * - Queue health and connection status
 * - Overall scalability health summary
 * - Cache flush operations (admin only)
 */

export { registerScalabilityRoutes } from './scalability-routes.js';
export type { ScalabilityRoutesOptions } from './scalability-routes.js';

export { default as adminDashboardPlugin } from './admin-dashboard-plugin.js';
export type { AdminDashboardPluginOptions } from './admin-dashboard-plugin.js';
