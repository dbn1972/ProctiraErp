/**
 * Unit tests for `selectDefaultDashboardRoute` — Task 52.1, Requirement 40.9.
 *
 * Verifies the scope→route mapping and the lowest-privilege fallback that
 * Task 52.1 specifies. The mapping function is intentionally pure so we can
 * exercise every combination without mounting a router or auth provider.
 */

import { describe, it, expect } from 'vitest';

import {
  DASHBOARD_ROUTES,
  FALLBACK_ROUTE,
  selectDefaultDashboardRoute,
  type RoleRouterInput,
} from './selectDefaultDashboardRoute';

function makeInput(overrides: Partial<RoleRouterInput>): RoleRouterInput {
  return {
    scope: undefined,
    roles: [],
    ...overrides,
  };
}

describe('selectDefaultDashboardRoute — scope mapping (Task 52.1, Req 40.9)', () => {
  it('routes country scope to /app/dashboard/country', () => {
    const target = selectDefaultDashboardRoute(
      makeInput({ scope: { level: 'country' } }),
    );
    expect(target).toBe(DASHBOARD_ROUTES.country);
    expect(target).toBe('/app/dashboard/country');
  });

  it('routes state scope to /app/dashboard/state', () => {
    const target = selectDefaultDashboardRoute(
      makeInput({ scope: { level: 'state' } }),
    );
    expect(target).toBe(DASHBOARD_ROUTES.state);
    expect(target).toBe('/app/dashboard/state');
  });

  it('routes board scope to /app/dashboard/board-admin', () => {
    const target = selectDefaultDashboardRoute(
      makeInput({ scope: { level: 'board' } }),
    );
    expect(target).toBe(DASHBOARD_ROUTES.boardAdmin);
    expect(target).toBe('/app/dashboard/board-admin');
  });
});

describe('selectDefaultDashboardRoute — role mapping (Task 52.1, Req 40.9)', () => {
  it('routes the board-admin role to /app/dashboard/board-admin', () => {
    expect(
      selectDefaultDashboardRoute(makeInput({ roles: ['board-admin'] })),
    ).toBe(DASHBOARD_ROUTES.boardAdmin);
  });

  it('routes the principal role to /app/dashboard/school', () => {
    expect(
      selectDefaultDashboardRoute(
        makeInput({ scope: { level: 'school' }, roles: ['principal'] }),
      ),
    ).toBe(DASHBOARD_ROUTES.school);
  });

  it('routes the teacher role to /app/dashboard/teacher', () => {
    expect(
      selectDefaultDashboardRoute(
        makeInput({ scope: { level: 'school' }, roles: ['teacher'] }),
      ),
    ).toBe(DASHBOARD_ROUTES.teacher);
  });

  it('routes the parent role to /app/dashboard/me', () => {
    expect(
      selectDefaultDashboardRoute(makeInput({ roles: ['parent'] })),
    ).toBe(DASHBOARD_ROUTES.me);
  });

  it('routes the student role to /app/dashboard/me', () => {
    expect(
      selectDefaultDashboardRoute(makeInput({ roles: ['student'] })),
    ).toBe(DASHBOARD_ROUTES.me);
  });

  it('treats common role aliases (snake_case, UPPER) the same as kebab-case', () => {
    expect(
      selectDefaultDashboardRoute(makeInput({ roles: ['BOARD_ADMIN'] })),
    ).toBe(DASHBOARD_ROUTES.boardAdmin);
    expect(
      selectDefaultDashboardRoute(makeInput({ roles: ['Board_Admin'] })),
    ).toBe(DASHBOARD_ROUTES.boardAdmin);
    expect(
      selectDefaultDashboardRoute(makeInput({ roles: ['TEACHER'] })),
    ).toBe(DASHBOARD_ROUTES.teacher);
  });
});

describe('selectDefaultDashboardRoute — precedence (Task 52.1)', () => {
  it('prefers a higher scope (country) over any role', () => {
    const target = selectDefaultDashboardRoute(
      makeInput({
        scope: { level: 'country' },
        roles: ['teacher', 'parent'],
      }),
    );
    expect(target).toBe(DASHBOARD_ROUTES.country);
  });

  it('prefers state scope over a teacher role', () => {
    const target = selectDefaultDashboardRoute(
      makeInput({ scope: { level: 'state' }, roles: ['teacher'] }),
    );
    expect(target).toBe(DASHBOARD_ROUTES.state);
  });

  it('prefers board scope over a principal role', () => {
    const target = selectDefaultDashboardRoute(
      makeInput({ scope: { level: 'board' }, roles: ['principal'] }),
    );
    expect(target).toBe(DASHBOARD_ROUTES.boardAdmin);
  });

  it('prefers principal over teacher when both roles are held', () => {
    const target = selectDefaultDashboardRoute(
      makeInput({
        scope: { level: 'school' },
        roles: ['teacher', 'principal'],
      }),
    );
    expect(target).toBe(DASHBOARD_ROUTES.school);
  });

  it('prefers teacher over student when both are held', () => {
    const target = selectDefaultDashboardRoute(
      makeInput({ roles: ['teacher', 'student'] }),
    );
    expect(target).toBe(DASHBOARD_ROUTES.teacher);
  });
});

describe('selectDefaultDashboardRoute — fallback (Task 52.1)', () => {
  it('falls back to /app/dashboard/me when no scope and no roles match', () => {
    const target = selectDefaultDashboardRoute(makeInput({}));
    expect(target).toBe(FALLBACK_ROUTE);
    expect(target).toBe('/app/dashboard/me');
  });

  it('falls back to /me for an unrecognised role', () => {
    const target = selectDefaultDashboardRoute(
      makeInput({ roles: ['some-future-role'] }),
    );
    expect(target).toBe(FALLBACK_ROUTE);
  });

  it('falls back to /me for a district scope without a matching role', () => {
    // District scope is rendered inline inside State_Dashboard (Design §G.2).
    // A user whose only scope is `district` and who holds none of the
    // recognised roles still gets the lowest-privilege landing surface.
    const target = selectDefaultDashboardRoute(
      makeInput({ scope: { level: 'district' } }),
    );
    expect(target).toBe(FALLBACK_ROUTE);
  });

  it('handles null/undefined scope and roles without throwing', () => {
    expect(
      selectDefaultDashboardRoute({ scope: null, roles: null }),
    ).toBe(FALLBACK_ROUTE);
    expect(
      selectDefaultDashboardRoute({ scope: undefined, roles: undefined }),
    ).toBe(FALLBACK_ROUTE);
  });
});
