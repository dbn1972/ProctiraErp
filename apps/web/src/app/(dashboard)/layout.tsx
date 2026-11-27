import { AppShell } from '@/components/layout/AppShell';
import { getTenantFeatureFlags } from '@/lib/api/entitlements';
import { requireSession } from '@/lib/auth/server';
import { FeatureFlagsProvider } from '@/providers/FeatureFlagsProvider';

/**
 * Authenticated dashboard layout.
 *
 * Enforces the session boundary (defence-in-depth alongside middleware)
 * and delegates the chrome to `<AppShell>`, which selects between
 * `<MobileShell>` (< 768 px) and `<DesktopShell>` (≥ 768 px) via the
 * `useViewport()` hook (Design §H, Requirement 41 / Task 53.1).
 *
 * The shells share the same `children` outlet so navigating across the
 * breakpoint does not unmount the page, and the providers higher up the
 * tree (auth, language, theme, connectivity) preserve session, locale,
 * theme, and Sync_Queue state through the switch (Requirement 41 AC 6).
 *
 * PRC-L078: feature flags come from the tenant's entitlements
 * (`GET /billing/me/entitlements`), not the hard-coded defaults. This provider
 * overrides the defaults-only one in `AppProviders` for every dashboard route.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  const featureFlags = await getTenantFeatureFlags();
  return (
    <FeatureFlagsProvider initialFlags={featureFlags}>
      <AppShell>{children}</AppShell>
    </FeatureFlagsProvider>
  );
}
