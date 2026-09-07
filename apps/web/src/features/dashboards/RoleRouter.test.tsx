/**
 * @vitest-environment jsdom
 *
 * <RoleRouter> tests — Task 52.1 / Requirement 40.9 / Design §G, §Q.
 *
 * Mounts `<RoleRouter>` inside a `<MemoryRouter>` with sibling stub routes
 * for every dashboard surface, primes `<AuthProvider>` with a fake user
 * carrying the scope/roles under test, and asserts the user lands on the
 * matching sub-route. Server-side RBAC is out of scope here — these tests
 * only verify the *default route selection* contract.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AuthProvider, type AuthUser } from '@/providers/AuthProvider';

import RoleRouter from './RoleRouter';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<AuthUser>): AuthUser {
  return {
    id: 'user-1',
    email: 'user@example.test',
    name: 'Test User',
    roles: [],
    permissions: [],
    scope: { level: 'school' },
    tenant_id: 'tenant-1',
    ...overrides,
  };
}

function renderRouter(user: AuthUser | null) {
  return render(
    <AuthProvider initialUser={user}>
      <MemoryRouter initialEntries={['/app/dashboard']}>
        <Routes>
          <Route path="/app/dashboard" element={<RoleRouter />} />
          <Route
            path="/app/dashboard/country"
            element={<div data-testid="country-page">country</div>}
          />
          <Route path="/app/dashboard/state" element={<div data-testid="state-page">state</div>} />
          <Route
            path="/app/dashboard/board-admin"
            element={<div data-testid="board-admin-page">board-admin</div>}
          />
          <Route
            path="/app/dashboard/school"
            element={<div data-testid="school-page">school</div>}
          />
          <Route
            path="/app/dashboard/teacher"
            element={<div data-testid="teacher-page">teacher</div>}
          />
          <Route path="/app/dashboard/me" element={<div data-testid="me-page">me</div>} />
          <Route path="/parent" element={<div data-testid="parent-portal-page">parent</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

// ─── Scope→route mapping ────────────────────────────────────────────────────

describe('<RoleRouter> — scope→route mapping (Task 52.1)', () => {
  it('routes country scope to the country dashboard', () => {
    renderRouter(makeUser({ scope: { level: 'country' } }));
    expect(screen.getByTestId('country-page')).toBeTruthy();
  });

  it('routes state scope to the state dashboard', () => {
    renderRouter(makeUser({ scope: { level: 'state' } }));
    expect(screen.getByTestId('state-page')).toBeTruthy();
  });

  it('routes board scope to the board-admin dashboard', () => {
    renderRouter(makeUser({ scope: { level: 'board' } }));
    expect(screen.getByTestId('board-admin-page')).toBeTruthy();
  });

  it('routes a board-admin role to the board-admin dashboard', () => {
    renderRouter(makeUser({ scope: { level: 'school' }, roles: ['board-admin'] }));
    expect(screen.getByTestId('board-admin-page')).toBeTruthy();
  });

  it('routes a principal role to the school dashboard', () => {
    renderRouter(makeUser({ scope: { level: 'school' }, roles: ['principal'] }));
    expect(screen.getByTestId('school-page')).toBeTruthy();
  });

  it('routes a teacher role to the teacher dashboard', () => {
    renderRouter(makeUser({ scope: { level: 'school' }, roles: ['teacher'] }));
    expect(screen.getByTestId('teacher-page')).toBeTruthy();
  });

  it('routes a parent role to the parent portal', () => {
    renderRouter(makeUser({ scope: { level: 'school' }, roles: ['parent'] }));
    expect(screen.getByTestId('parent-portal-page')).toBeTruthy();
  });

  it('routes a student role to the parent portal', () => {
    renderRouter(makeUser({ scope: { level: 'school' }, roles: ['student'] }));
    expect(screen.getByTestId('parent-portal-page')).toBeTruthy();
  });
});

// ─── Fallback ───────────────────────────────────────────────────────────────

describe('<RoleRouter> — fallback (Task 52.1)', () => {
  it('falls back to the personal dashboard when the user has no matching role/scope', () => {
    renderRouter(makeUser({ scope: { level: 'school' }, roles: ['some-future-role'] }));
    expect(screen.getByTestId('me-page')).toBeTruthy();
  });

  it('falls back to the personal dashboard when the auth context is unauthenticated', () => {
    renderRouter(null);
    expect(screen.getByTestId('me-page')).toBeTruthy();
  });
});
