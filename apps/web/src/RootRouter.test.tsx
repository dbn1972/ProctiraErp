/**
 * @vitest-environment jsdom
 *
 * Tests for RootRouter route gating (Task 53.5 / Requirements 41.1, 29.5)
 *
 * Verifies that:
 *   - With `legacy_mobile_routes=off` (the default), the legacy `/mobile/*`
 *     routes are NOT registered. The `/mobile` branch of the route tree is
 *     omitted entirely so the responsive shell becomes the default.
 *   - With `legacy_mobile_routes=on`, the legacy mobile routes are
 *     registered under `/mobile`, matching the routes declared in the
 *     federated feature registry.
 *   - Modules without a `requiredFeatureFlag` (public, auth, app scopes)
 *     are always registered regardless of the flag map.
 *   - `isModuleEnabled` correctly answers the gating predicate for every
 *     registry entry under both flag states.
 */
import { describe, it, expect, vi } from 'vitest';
import type { RouteObject } from 'react-router-dom';

// React Router's BrowserRouter requires a DOM and history; we don't need to
// mount it in these tests, only inspect `buildRoutes`. Stub
// `createBrowserRouter` to avoid touching window.history.
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return {
    ...actual,
    createBrowserRouter: (routes: unknown) => ({ routes }),
  };
});

// `LiveRegion` lives in a workspace package that pulls in browser globals at
// import time. The route-building tests do not render it, so a no-op stub
// keeps the test environment lean.
vi.mock('@proctira/ui-components', () => ({
  LiveRegion: () => null,
}));

import { buildRoutes, isModuleEnabled } from './RootRouter';
import { featureRegistry } from './featureRegistry';
import {
  DEFAULT_FEATURE_FLAGS,
  LEGACY_MOBILE_ROUTES_FEATURE_KEY,
  type FeatureFlags,
} from './providers/FeatureFlagsProvider';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFlags(legacyMobile: boolean): FeatureFlags {
  return Object.freeze({
    ...DEFAULT_FEATURE_FLAGS,
    [LEGACY_MOBILE_ROUTES_FEATURE_KEY]: legacyMobile,
  });
}

function findGroup(tree: RouteObject[], path: string): RouteObject | undefined {
  return tree.find((r) => r.path === path);
}

// ─── Module gating ───────────────────────────────────────────────────────────

describe('isModuleEnabled', () => {
  it('returns true for modules without a requiredFeatureFlag', () => {
    const moduleWithoutFlag = featureRegistry.find((m) => !m.requiredFeatureFlag);
    expect(moduleWithoutFlag).toBeDefined();
    expect(isModuleEnabled(moduleWithoutFlag!, makeFlags(false))).toBe(true);
    expect(isModuleEnabled(moduleWithoutFlag!, makeFlags(true))).toBe(true);
  });

  it('returns false for legacy_mobile modules when the flag is off', () => {
    const legacyModules = featureRegistry.filter(
      (m) => m.requiredFeatureFlag === LEGACY_MOBILE_ROUTES_FEATURE_KEY,
    );
    expect(legacyModules.length).toBeGreaterThan(0);
    for (const m of legacyModules) {
      expect(isModuleEnabled(m, makeFlags(false))).toBe(false);
    }
  });

  it('returns true for legacy_mobile modules when the flag is on', () => {
    const legacyModules = featureRegistry.filter(
      (m) => m.requiredFeatureFlag === LEGACY_MOBILE_ROUTES_FEATURE_KEY,
    );
    expect(legacyModules.length).toBeGreaterThan(0);
    for (const m of legacyModules) {
      expect(isModuleEnabled(m, makeFlags(true))).toBe(true);
    }
  });
});

// ─── Route tree shape ────────────────────────────────────────────────────────

describe('buildRoutes — legacy_mobile_routes=off (default for new tenants)', () => {
  const tree = buildRoutes(makeFlags(false));

  it('does not register a /mobile branch when the flag is off', () => {
    expect(findGroup(tree, '/mobile')).toBeUndefined();
  });

  it('still registers the /, /auth, and /app branches', () => {
    expect(findGroup(tree, '/')).toBeDefined();
    expect(findGroup(tree, '/auth')).toBeDefined();
    expect(findGroup(tree, '/app')).toBeDefined();
  });

  it('keeps the catch-all 404 route last', () => {
    const last = tree[tree.length - 1];
    expect(last?.path).toBe('*');
  });

  it('omits routes for the legacy MobileDashboard, MobileAttendance, MobileStudentProfile modules', () => {
    const legacyIds = featureRegistry
      .filter((m) => m.requiredFeatureFlag === LEGACY_MOBILE_ROUTES_FEATURE_KEY)
      .map((m) => m.routePrefix);

    expect(legacyIds).toEqual(
      expect.arrayContaining(['dashboard', 'attendance', 'student-profile']),
    );

    // No /mobile branch at all → no legacy children either.
    expect(findGroup(tree, '/mobile')).toBeUndefined();
  });
});

describe('buildRoutes — legacy_mobile_routes=on (existing tenants opt in)', () => {
  const tree = buildRoutes(makeFlags(true));

  it('registers the /mobile branch when the flag is on', () => {
    const mobileGroup = findGroup(tree, '/mobile');
    expect(mobileGroup).toBeDefined();
  });

  it('registers the legacy MobileDashboard, MobileAttendance, MobileStudentProfile routes under /mobile', () => {
    const mobileGroup = findGroup(tree, '/mobile');
    const childPaths = (mobileGroup?.children ?? []).map((c) => c.path);

    expect(childPaths).toEqual(
      expect.arrayContaining(['dashboard', 'attendance', 'student-profile']),
    );
  });

  it('registers exactly the modules declared in the federated registry under the mobile scope', () => {
    const mobileGroup = findGroup(tree, '/mobile');
    const expectedCount = featureRegistry.filter(
      (m) =>
        m.scope === 'mobile' &&
        (!m.requiredFeatureFlag || m.requiredFeatureFlag === LEGACY_MOBILE_ROUTES_FEATURE_KEY),
    ).length;
    expect(mobileGroup?.children?.length).toBe(expectedCount);
  });

  it('still keeps the catch-all 404 route last', () => {
    const last = tree[tree.length - 1];
    expect(last?.path).toBe('*');
  });
});

describe('buildRoutes — non-mobile scopes are unaffected by the flag', () => {
  it('produces identical /, /auth, and /app branches whether the flag is on or off', () => {
    const offTree = buildRoutes(makeFlags(false));
    const onTree = buildRoutes(makeFlags(true));

    for (const path of ['/', '/auth', '/app']) {
      const offGroup = findGroup(offTree, path);
      const onGroup = findGroup(onTree, path);

      const offChildren = (offGroup?.children ?? []).map(
        (c) => c.path ?? (c.index ? '__index__' : ''),
      );
      const onChildren = (onGroup?.children ?? []).map(
        (c) => c.path ?? (c.index ? '__index__' : ''),
      );

      expect(offChildren).toEqual(onChildren);
    }
  });
});
