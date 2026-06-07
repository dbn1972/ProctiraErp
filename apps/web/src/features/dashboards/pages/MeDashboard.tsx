/**
 * MeDashboard — route entry-point for `/app/dashboard/me`.
 *
 * Wired by `RoleRouter` (Task 52.1) so that parents and students landing
 * on `/app/dashboard` see a personal-scope surface, and so that any
 * user with no matching role/scope still reaches a renderable
 * lowest-privilege page (the task 52.1 fallback contract).
 *
 * The full implementation lives in `ParentStudentDashboard.tsx`
 * (Task 52.4 / Requirement 40.8) — this file simply re-exports it so
 * the route registry, fallback wiring, and `HomeRouter` lazy import all
 * keep pointing at a stable module name.
 *
 * _Design: G.8_
 */
export { default } from './ParentStudentDashboard';
