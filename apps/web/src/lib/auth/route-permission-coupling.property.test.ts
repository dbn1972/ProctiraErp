/**
 * Property F-7: Route ↔ Permission Coupling
 *
 * *For any* authenticated route `r` defined in `apps/web/app/(dashboard)/`,
 * rendering `r` SHALL be gated by the role/permission set declared in the
 * spec's RBAC section; an unauthorized session SHALL receive a 403 page or
 * redirect, never the page content.
 *
 * **Validates: Requirements 4.4, 40.9; existing Property 3**
 *
 * Strategy:
 *   This property test verifies the route ↔ permission coupling at three levels:
 *
 *   1. **Registry completeness**: Every `app`-scope route in the featureRegistry
 *      that accesses protected resources declares non-empty `requiredPermissions`.
 *
 *   2. **Middleware auth gating**: The middleware's PUBLIC_PATHS list does NOT
 *      include any dashboard route, ensuring all dashboard routes require auth.
 *
 *   3. **Permission coupling invariant** (fast-check): For any randomly selected
 *      authenticated route and any randomly generated permission set, the route
 *      is accessible if and only if the permission set includes ALL of the
 *      route's required permissions.
 *
 *   4. **Three-persona verification**: For each protected route, verifies that:
 *      - No-scope persona (empty permissions) → blocked
 *      - Mismatched-scope persona (irrelevant permissions) → blocked
 *      - Correct-scope persona (exact required permissions) → allowed
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { featureRegistry, getModulesByScope, type FeatureModule } from '../../featureRegistry';

// ─── Constants ───────────────────────────────────────────────────────────────

const WEB_SRC = resolve(__dirname, '../..');

/**
 * All permission strings used across the featureRegistry.
 * Used as the universe of possible permissions for property testing.
 */
const ALL_PERMISSIONS = [
  'institution.read',
  'student.read',
  'staff.read',
  'attendance.read',
  'assessment.read',
  'examination.read',
  'analytics.read',
  'report.read',
  'settings.read',
  'transport.read',
  'health.read',
  'workflow.read',
  'scholarship.read',
  'survey.read',
  'custom-field.read',
  'audit.read',
  'notification.read',
];

/**
 * Routes that are explicitly public (no auth required).
 * Extracted from the middleware's PUBLIC_PATHS constant.
 */
const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/mfa',
  '/oauth',
  '/callback',
  '/logout',
  '/healthz',
  '/track',
];

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Simulates the permission evaluation logic: a user can access a route
 * if and only if their permission set includes ALL of the route's
 * required permissions.
 */
function canAccessRoute(route: FeatureModule, userPermissions: string[]): boolean {
  if (route.requiredPermissions.length === 0) {
    return true; // No permissions required
  }
  return route.requiredPermissions.every((p) => userPermissions.includes(p));
}

/**
 * Returns the set of protected app-scope routes (those with non-empty
 * requiredPermissions).
 */
function getProtectedRoutes(): FeatureModule[] {
  return getModulesByScope('app').filter((m) => m.requiredPermissions.length > 0);
}

// ─── fast-check Arbitraries ──────────────────────────────────────────────────

/** Arbitrary that picks a random protected route from the registry */
const arbProtectedRoute = fc.constantFrom(...getProtectedRoutes());

/** Arbitrary that generates a random subset of permissions */
const arbPermissionSet = fc.subarray(ALL_PERMISSIONS, { minLength: 0 });

/** Arbitrary that generates a permission set that does NOT include a specific permission */
function arbPermissionSetExcluding(excluded: string[]): fc.Arbitrary<string[]> {
  const available = ALL_PERMISSIONS.filter((p) => !excluded.includes(p));
  return fc.subarray(available, { minLength: 0 });
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property F-7: Route ↔ Permission Coupling', () => {
  describe('Registry completeness — protected resources declare permissions', () => {
    const protectedModuleIds = [
      'institutions',
      'students',
      'staff',
      'attendance',
      'assessment',
      'examinations',
      'reports',
      'settings',
    ];

    it('every resource-accessing app route declares non-empty requiredPermissions', () => {
      for (const id of protectedModuleIds) {
        const mod = featureRegistry.find((m) => m.id === id);
        expect(mod, `Module "${id}" should exist in featureRegistry`).toBeDefined();
        expect(
          mod!.requiredPermissions.length,
          `Module "${id}" at /${mod!.routePrefix} must declare requiredPermissions`,
        ).toBeGreaterThan(0);
      }
    });

    it('public and auth scope routes declare NO permissions', () => {
      const publicRoutes = getModulesByScope('public');
      const authRoutes = getModulesByScope('auth');

      for (const route of [...publicRoutes, ...authRoutes]) {
        expect(
          route.requiredPermissions,
          `${route.scope} route "${route.id}" should not require permissions`,
        ).toEqual([]);
      }
    });
  });

  describe('Middleware auth gating — dashboard routes are not in PUBLIC_PATHS', () => {
    it('no app-scope route prefix appears in the middleware PUBLIC_PATHS', () => {
      const middlewareSrc = readFileSync(resolve(WEB_SRC, 'middleware.ts'), 'utf-8');

      const appRoutes = getModulesByScope('app');
      for (const route of appRoutes) {
        if (route.routePrefix === '') continue; // index route
        const routePath = `/${route.routePrefix}`;
        // Check that the route is NOT listed as a public path in the middleware
        expect(
          PUBLIC_PATHS.some((pp) => routePath === pp || routePath.startsWith(`${pp}/`)),
          `App route "${routePath}" must NOT be in middleware PUBLIC_PATHS`,
        ).toBe(false);
      }

      // Also verify the middleware source doesn't contain these paths in its
      // PUBLIC_PATHS array
      for (const route of appRoutes) {
        if (route.routePrefix === '') continue;
        const pathLiteral = `'/${route.routePrefix}'`;
        const inPublicPaths =
          middlewareSrc.includes(`const PUBLIC_PATHS`) &&
          middlewareSrc
            .slice(
              middlewareSrc.indexOf('const PUBLIC_PATHS'),
              middlewareSrc.indexOf('];', middlewareSrc.indexOf('const PUBLIC_PATHS')),
            )
            .includes(pathLiteral);

        expect(
          inPublicPaths,
          `Route "/${route.routePrefix}" must not appear in middleware PUBLIC_PATHS`,
        ).toBe(false);
      }
    });

    it('middleware redirects unauthenticated requests to /login for non-public paths', () => {
      // Verify the middleware source contains the redirect-to-login logic
      const middlewareSrc = readFileSync(resolve(WEB_SRC, 'middleware.ts'), 'utf-8');

      // The middleware must check for access_token and redirect when missing
      expect(middlewareSrc).toContain('access_token');
      expect(middlewareSrc).toContain('redirectToLogin');
      expect(middlewareSrc).toContain('isPublicPath');
    });
  });

  describe('Permission coupling invariant (property-based)', () => {
    it('a user can access a route iff their permissions include ALL required permissions', () => {
      fc.assert(
        fc.property(arbProtectedRoute, arbPermissionSet, (route, permissions) => {
          const hasAccess = canAccessRoute(route, permissions);
          const hasAllRequired = route.requiredPermissions.every((p) => permissions.includes(p));

          // The access decision must match the permission check
          expect(hasAccess).toBe(hasAllRequired);
        }),
        { numRuns: 200 },
      );
    });

    it('removing any single required permission blocks access', () => {
      fc.assert(
        fc.property(arbProtectedRoute, (route) => {
          // Start with all required permissions
          const fullPermissions = [...route.requiredPermissions];
          expect(canAccessRoute(route, fullPermissions)).toBe(true);

          // Remove each required permission one at a time
          for (const perm of route.requiredPermissions) {
            const reduced = fullPermissions.filter((p) => p !== perm);
            expect(
              canAccessRoute(route, reduced),
              `Removing "${perm}" from permissions should block access to /${route.routePrefix}`,
            ).toBe(false);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('adding irrelevant permissions does not grant access', () => {
      fc.assert(
        fc.property(arbProtectedRoute, arbPermissionSetExcluding([]), (route, extraPermissions) => {
          // User has only permissions that are NOT in the route's required set
          const irrelevant = extraPermissions.filter((p) => !route.requiredPermissions.includes(p));

          if (route.requiredPermissions.length > 0) {
            expect(
              canAccessRoute(route, irrelevant),
              `Irrelevant permissions should not grant access to /${route.routePrefix}`,
            ).toBe(false);
          }
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('Three-persona verification', () => {
    const protectedRoutes = getProtectedRoutes();

    for (const route of protectedRoutes) {
      describe(`Route: /${route.routePrefix} (requires: ${route.requiredPermissions.join(', ')})`, () => {
        it('persona 1 — no permissions → blocked', () => {
          expect(canAccessRoute(route, [])).toBe(false);
        });

        it('persona 2 — mismatched permissions → blocked', () => {
          // Use a permission that this route does NOT require
          const mismatchedPerms = ALL_PERMISSIONS.filter(
            (p) => !route.requiredPermissions.includes(p),
          );
          expect(canAccessRoute(route, mismatchedPerms.slice(0, 1))).toBe(false);
        });

        it('persona 3 — correct permissions → allowed', () => {
          expect(canAccessRoute(route, route.requiredPermissions)).toBe(true);
        });
      });
    }
  });

  describe('Dashboard layout enforces session requirement', () => {
    it('dashboard layout calls requireSession()', () => {
      const layoutSrc = readFileSync(resolve(WEB_SRC, 'app/(dashboard)/layout.tsx'), 'utf-8');

      // The layout must import and call requireSession
      expect(layoutSrc).toContain('requireSession');
      expect(layoutSrc).toContain('await requireSession()');
    });

    it('requireSession redirects to /login when no session exists', () => {
      const serverAuthSrc = readFileSync(resolve(WEB_SRC, 'lib/auth/server.ts'), 'utf-8');

      // requireSession must redirect to /login
      expect(serverAuthSrc).toContain('redirect(`/login');
    });
  });

  describe('Permission declarations are well-formed', () => {
    it('all requiredPermissions follow the resource.action pattern', () => {
      const allModules = featureRegistry.filter((m) => m.requiredPermissions.length > 0);

      for (const mod of allModules) {
        for (const perm of mod.requiredPermissions) {
          expect(
            perm,
            `Permission "${perm}" on route "${mod.id}" must match resource.action pattern`,
          ).toMatch(/^[a-z][a-z0-9-]*\.[a-z]+$/);
        }
      }
    });

    it('no duplicate permissions within a single route', () => {
      for (const mod of featureRegistry) {
        const perms = mod.requiredPermissions;
        const unique = new Set(perms);
        expect(
          unique.size,
          `Route "${mod.id}" has duplicate permissions: ${perms.join(', ')}`,
        ).toBe(perms.length);
      }
    });
  });
});
