import { AppShell } from '@/components/layout/AppShell';
import { TenantIdentityBlock } from '@/components/layout/TenantIdentityBlock';
import type { HeaderIdentity } from '@/components/layout/header';
import { requireSession } from '@/lib/auth/server';
import { primaryRoleFromTokenPayload } from '@/lib/auth/auth-user';
import { getTenantSettings } from '@/lib/api/admin.server';
import { listStudents } from '@/lib/api/students';
import { getUnreadNotificationCount } from '@/lib/api/notifications-inbox';

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
 * Sidebar tenant identity block (Requirement 1, Task 11.2): this layout
 * wraps every dashboard route, not just the home page, so it resolves
 * `TenantIdentityBlock` — an async Server Component — itself here and
 * passes the ALREADY-RENDERED element down through `<AppShell>` →
 * `<DesktopShell>` → `<Sidebar>` as the `tenantIdentitySlot` prop.
 * `Sidebar` is a Client Component and cannot render an async Server
 * Component directly; this is the standard App Router pattern for that
 * boundary (a Server Component parent resolves the child and hands the
 * client component its rendered output, the same way `children` works).
 * `TenantIdentityBlock` is called directly (`await TenantIdentityBlock(...)`)
 * rather than referenced as JSX so the value handed to `<AppShell>` is
 * always a concrete, already-resolved element (or `null`) — never a
 * pending async component reference.
 *
 * The student headcount is fetched independently via
 * `listStudents({ pageSize: 1 })` — the same cheap count-only query
 * `page.tsx` runs for the Students KPI card — rather than threading
 * `page.tsx`'s already-fetched value across routes, since this layout
 * applies to every dashboard route, not only `/`.
 *
 * Header identity (Requirement 2, Task 12.1): the same rationale applies
 * to the header's tenant name. `TenantIdentityBlock` already calls
 * `getTenantSettings()` internally (Task 11.1) and stays self-contained —
 * this layout does its OWN separate `getTenantSettings()` call below for
 * `headerIdentity.tenantName` rather than refactoring
 * `TenantIdentityBlock` to accept `displayName` as a prop. Threading a
 * single shared fetch into both consumers would save one gateway call per
 * page load, but it would also change `TenantIdentityBlock`'s prop
 * contract (and its existing tests) for a duplication that is already the
 * accepted pattern in this exact file for the student headcount — both
 * calls are cheap, tenant-scoped, cached reads (`next: { revalidate: 0 }`
 * inside `getTenantSettings()`/`listStudents()`), not expensive queries,
 * so the minimal, lower-risk option is a second call here, consistent
 * with how `listStudents` is already handled.
 *
 * `displayName`/`primaryRole` come directly off the session's decoded
 * `TokenPayload` (`session.user`) — no extra fetch needed, since
 * `requireSession()` already decoded the access token cookie.
 *
 * Notification bell (Requirement 2, Task 12.3): `headerIdentity` also
 * carries `unreadNotificationCount`, resolved here via
 * `getUnreadNotificationCount(session.user.sub)` — extending the same
 * "header's own resolved server data" bag rather than threading a
 * separate prop through `AppShell` → `DesktopShell`, since this is
 * already exactly that: data `Header` needs that only a Server Component
 * can fetch (`getUnreadNotificationCount()` depends on `next/headers`,
 * same as `getTenantSettings()`/`listStudents()` above). The fetch
 * degrades to `0` on failure (`.catch(() => 0)`), per Req 2.7's explicit
 * "never an error state in the header" — the identical degradation
 * shape already used for `students` above, just defaulting to `0`
 * instead of `null` since `Header` treats "no data" and "zero unread"
 * identically (a plain bell, no badge).
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  const students = await listStudents({ pageSize: 1 }).catch(() => null);
  const studentCount = students ? students.meta?.totalItems ?? 0 : null;
  const tenantIdentitySlot = await TenantIdentityBlock({ studentCount });

  const { settings } = await getTenantSettings().catch(() => ({ settings: null }));
  const unreadNotificationCount = await getUnreadNotificationCount(session.user.sub).catch(
    () => 0,
  );
  const headerIdentity: HeaderIdentity = {
    displayName: session.user.displayName ?? null,
    email: session.user.email,
    primaryRole: primaryRoleFromTokenPayload(session.user),
    tenantName: settings?.displayName || null,
    unreadNotificationCount,
  };

  return (
    <AppShell tenantIdentitySlot={tenantIdentitySlot} headerIdentity={headerIdentity}>
      {children}
    </AppShell>
  );
}
