/**
 * RootRouter — Federated Route Registry Consumer
 *
 * Consumes the featureRegistry and produces the public, auth, app, and mobile
 * route groups using React Router v7 createBrowserRouter with nested lazy()
 * route definitions.
 *
 * Each feature module is loaded as an async chunk via React.lazy(), matching
 * the Vite manualChunks configuration for per-feature code splitting.
 *
 * Feature flag gating
 * -------------------
 * Modules with a `requiredFeatureFlag` are only included in the route tree
 * when the flag resolves to `true` for the current tenant. The legacy
 * `/mobile/*` routes (Task 53.5 / Requirement 41.1) opt into this — they are
 * registered only when `useFeatureFlags().isEnabled('legacy_mobile_routes')`,
 * keeping the responsive shell as the default for new tenants while existing
 * tenants can opt back in to the legacy mobile experience.
 */

import React, { lazy, Suspense, useMemo } from 'react';
import { createBrowserRouter, RouterProvider, Outlet, type RouteObject } from 'react-router-dom';
import { LiveRegion } from '@proctira/ui-components';
import { featureRegistry, getModulesByScope, type FeatureModule } from './featureRegistry';
import { useFeatureFlags, type FeatureFlags } from './providers/FeatureFlagsProvider';

// ─── Layout Shells (loaded eagerly as part of the app shell) ─────────────────

/** Public layout for marketing/legal pages */
function PublicLayout() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Outlet />
    </Suspense>
  );
}

/** Auth layout for sign-in/sign-up flows */
function AuthLayout() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Outlet />
    </Suspense>
  );
}

/** Authenticated app shell with sidebar, header, etc. */
function AppShell() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      {/*
       * Global ARIA live regions (Task 54.7 / Design L). Mounted once
       * inside the authenticated shell so any descendant can call
       * `useAnnounce()` to push polite or assertive screen-reader
       * announcements (sync events, save confirmations, errors).
       */}
      <LiveRegion />
      <Outlet />
    </Suspense>
  );
}

/** Mobile-optimized layout with bottom tabs */
function MobileLayout() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Outlet />
    </Suspense>
  );
}

/**
 * Loading fallback shown while lazy chunks are loading.
 *
 * The spin animation is gated behind Tailwind's `motion-safe:` variant so that
 * users with `prefers-reduced-motion: reduce` see a static indicator instead
 * (Requirement 39.5 / Design §J). The container retains `role="status"` and
 * the loading affordance for assistive technologies regardless of motion.
 */
function LoadingFallback() {
  return (
    <div
      className="flex items-center justify-center min-h-[200px]"
      role="status"
      aria-label="Loading"
    >
      <div className="motion-safe:animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
    </div>
  );
}

/** 404 Not Found page (loaded eagerly since it's small) */
function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-lg text-neutral-600">Page not found</p>
    </div>
  );
}

// ─── Route Builder ───────────────────────────────────────────────────────────

/**
 * Wraps a feature module's lazy import into a React.lazy component
 * suitable for use in React Router's Component property.
 */
function createLazyComponent(featureModule: FeatureModule) {
  return lazy(featureModule.lazyImport);
}

/**
 * Converts a FeatureModule into a RouteObject for React Router.
 */
function featureToRoute(feature: FeatureModule): RouteObject {
  const LazyComponent = createLazyComponent(feature);

  const element = (
    <Suspense fallback={<LoadingFallback />}>
      <LazyComponent />
    </Suspense>
  );

  if (feature.isIndex) {
    return { index: true, element };
  }

  const path = feature.hasSubRoutes ? `${feature.routePrefix}/*` : feature.routePrefix;

  return { path, element };
}

/**
 * Returns whether a feature module is enabled for the supplied flag map.
 * Modules without a `requiredFeatureFlag` are always enabled. Modules whose
 * flag resolves to `false` (or is absent from the map) are filtered out.
 */
export function isModuleEnabled(feature: FeatureModule, flags: FeatureFlags): boolean {
  if (!feature.requiredFeatureFlag) return true;
  // Cast through unknown so callers can supply any feature-flag string. The
  // provider only types known keys but registry entries reference the same
  // string constants, so missing keys safely fall through to `false`.
  const value = (flags as unknown as Record<string, boolean | undefined>)[
    feature.requiredFeatureFlag
  ];
  return value === true;
}

/**
 * Filters the supplied modules by their `requiredFeatureFlag`, keeping only
 * those whose flag is enabled (or has no flag at all).
 */
function filterByFlags(modules: FeatureModule[], flags: FeatureFlags): FeatureModule[] {
  return modules.filter((m) => isModuleEnabled(m, flags));
}

/**
 * Builds the complete route tree from the feature registry, honouring the
 * supplied feature flag map. Modules whose `requiredFeatureFlag` is disabled
 * are omitted entirely so they neither register nor lazy-load.
 */
function buildRoutes(flags: FeatureFlags): RouteObject[] {
  const publicModules = filterByFlags(getModulesByScope('public'), flags);
  const authModules = filterByFlags(getModulesByScope('auth'), flags);
  const appModules = filterByFlags(getModulesByScope('app'), flags);
  const mobileModules = filterByFlags(getModulesByScope('mobile'), flags);

  const tree: RouteObject[] = [
    // PUBLIC group — anonymous, marketing + legal + registration
    {
      path: '/',
      element: <PublicLayout />,
      children: publicModules.map(featureToRoute),
    },
    // AUTH group — anonymous-only auth flows
    {
      path: '/auth',
      element: <AuthLayout />,
      children: authModules.map(featureToRoute),
    },
    // APP group — authenticated dashboard shell
    {
      path: '/app',
      element: <AppShell />,
      children: appModules.map(featureToRoute),
    },
  ];

  // MOBILE group — only registered when at least one mobile module survives
  // the feature-flag filter. With `legacy_mobile_routes=off` the entire
  // `/mobile/*` branch disappears so the responsive shell becomes the only
  // mobile UI surface (Task 53.5 / Requirement 41.1).
  if (mobileModules.length > 0) {
    tree.push({
      path: '/mobile',
      element: <MobileLayout />,
      children: mobileModules.map(featureToRoute),
    });
  }

  // 404 catch-all
  tree.push({
    path: '*',
    element: <NotFound />,
  });

  return tree;
}

// ─── RootRouter Component ────────────────────────────────────────────────────

/**
 * The root router component that provides the router to the application.
 * Mount this inside the provider hierarchy (after BrandConfig, Language,
 * Theme, Connectivity, Auth, and FeatureFlags providers).
 *
 * The router instance is recomputed when the resolved feature flag map
 * changes so toggling, e.g. `legacy_mobile_routes`, refreshes the registered
 * routes without a full page reload.
 */
export function RootRouter() {
  const { flags } = useFeatureFlags();
  const router = useMemo(() => createBrowserRouter(buildRoutes(flags)), [flags]);
  return <RouterProvider router={router} />;
}

// ─── Exports for testing ─────────────────────────────────────────────────────

export { buildRoutes, featureToRoute, createLazyComponent };
export type { RouteObject };
