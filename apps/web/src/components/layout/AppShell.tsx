'use client';

import React from 'react';
import { useViewport } from '@/hooks/useViewport';
import { DesktopShell } from './DesktopShell';
import { MobileShell } from './MobileShell';

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
export function AppShell({ children }: { children: React.ReactNode }) {
  const { isMobile } = useViewport();

  if (isMobile) {
    return <MobileShell>{children}</MobileShell>;
  }

  return <DesktopShell>{children}</DesktopShell>;
}

export default AppShell;
