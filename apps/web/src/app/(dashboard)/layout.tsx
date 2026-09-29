import { AppShell } from '@/components/layout/AppShell';
import { requireSession } from '@/lib/auth/server';

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
 * Sidebar tenant identity (Requirement 1) and header identity/help/bell
 * (Requirement 2) are NOT threaded through this layout as props. Both
 * `<Sidebar>` and `<Header>` (`apps/web/src/components/layout/{sidebar,header}.tsx`)
 * are self-sufficient Client Components: they read `useAuth()` for
 * session identity and `useDirectoryContext()` (a same-origin fetch of
 * `GET /api/v1/institutions/directory-context`) for the tenant/org name
 * and headcount, rather than requiring a Server Component ancestor to
 * resolve and pass that data down. This layout's only remaining job is
 * the session boundary check.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return <AppShell>{children}</AppShell>;
}
