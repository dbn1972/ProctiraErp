'use client';

import React from 'react';
import { useViewport } from '@/hooks/useViewport';
import { DesktopShell } from './DesktopShell';
import { MobileShell } from './MobileShell';
import type { HeaderIdentity } from './header';

/**
 * AppShell — Authenticated layout selector (Design §H, Requirement 41).
 *
 * Subscribes to `useViewport()` and mounts the appropriate chrome:
 *
 *   • `<MobileShell>` when the viewport is below 768 px.
 *   • `<DesktopShell>` at 768 px and above.
 *
 * Both shells render the SAME `children` outlet, so the routed page does
 * not unmount when the user resizes across the breakpoint and the shared
 * providers above (`<AuthProvider>`, `<LanguageProvider>`,
 * `<ThemeProvider>`, `<ConnectivityProvider>`, Sync_Queue) preserve
 * session, locale, theme, and pending offline operations
 * (Requirement 41 AC 6).
 *
 * The hook returns `isMobile === false` during SSR / first paint, so the
 * server always renders the desktop shell. The first client effect
 * reconciles to the real viewport, and small clients hydrate into
 * `<MobileShell>` immediately afterwards.
 */
export interface AppShellProps {
  children: React.ReactNode;
  /**
   * Server-rendered tenant/school identity block (Requirement 1),
   * resolved by `DashboardLayout` and forwarded to `<DesktopShell>` →
   * `<Sidebar>`. `<MobileShell>` has no sidebar concept (bottom-tab +
   * drawer chrome instead), so the slot is intentionally not forwarded
   * there — see `MobileShell.tsx`'s own doc comment for its chrome
   * pattern.
   */
  tenantIdentitySlot?: React.ReactNode;
  /**
   * Real session identity for the header's user menu (Requirement 2,
   * Task 12.1), resolved by `DashboardLayout` alongside
   * `tenantIdentitySlot` and forwarded to `<DesktopShell>` → `<Header>`.
   *
   * Unlike `tenantIdentitySlot`, this is plain data rather than a
   * pre-rendered element — `Header` is where the identity actually gets
   * formatted/rendered, so there is nothing to pre-render server-side.
   * `<MobileShell>` has its own header today with no identity display of
   * its own; wiring this into the mobile header is not part of this task.
   */
  headerIdentity?: HeaderIdentity;
}

export function AppShell({ children, tenantIdentitySlot, headerIdentity }: AppShellProps) {
  const { isMobile } = useViewport();

  if (isMobile) {
    return <MobileShell>{children}</MobileShell>;
  }

  return (
    <DesktopShell tenantIdentitySlot={tenantIdentitySlot} headerIdentity={headerIdentity}>
      {children}
    </DesktopShell>
  );
}

export default AppShell;
