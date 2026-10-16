import { describe, expect, it } from 'vitest';

import { buildRoleDashboard, inferDashboardRole, resolveDashboardRole } from './dashboards.js';

describe('W2-UX-04 role dashboards', () => {
  it('treats staff as its own dashboard (not teacher/principal)', () => {
    expect(inferDashboardRole([{ roleName: 'STAFF' }])).toBe('staff');
    expect(inferDashboardRole([{ roleId: 'librarian' }])).toBe('staff');
    expect(buildRoleDashboard('staff').cards[0]?.id).toContain('staff');
  });

  it('keeps principal for admins and does not use it as unknown fallback', () => {
    expect(inferDashboardRole([{ roleName: 'Administrator' }])).toBe('principal');
    expect(inferDashboardRole([{ roleName: 'mystery-role' }])).toBe('staff');
  });

  it('forbids staff from requesting principal aggregates', () => {
    expect(() => resolveDashboardRole([{ roleName: 'STAFF' }], 'principal')).toThrow(
      /cannot fetch principal/i,
    );
  });

  // PRC-L343: the dashboard query schema must accept 'staff' (previously
  // dropped) and reject unknown roles so the route can return 400 instead of
  // silently falling back.
  it('accepts staff in the dashboard query schema and rejects unknown roles', async () => {
    const { DashboardQuerySchema } = await import('./catalogue-schemas.js');
    const { validate } = await import('@proctira/validation');
    expect(validate(DashboardQuerySchema, { role: 'staff' }).success).toBe(true);
    expect(validate(DashboardQuerySchema, { role: 'board' }).success).toBe(true);
    // Would be accepted (and silently dropped) before 'staff' joined the union.
    expect(validate(DashboardQuerySchema, { role: 'hostel_head' }).success).toBe(false);
    expect(validate(DashboardQuerySchema, { role: '__proto__' }).success).toBe(false);
  });

  it('infers a staff dashboard for a hostel_head role id (requested-role gate still applies)', () => {
    // hostel_head is not a valid dashboard query role; the actor inference maps
    // it via substring to principal, but it is never silently accepted as a
    // requested dashboard role (schema rejects it -> 400 at the route).
    expect(inferDashboardRole([{ roleId: 'hostel_head' }])).toBe('principal');
  });
});
