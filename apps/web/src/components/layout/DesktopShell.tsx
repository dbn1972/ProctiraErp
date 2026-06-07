'use client';

import React from 'react';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { Breadcrumbs } from './breadcrumbs';
import { PageErrorBoundary } from '@/components/PageErrorBoundary';
import { CommandPalette } from '@/components/CommandPalette';

/**
 * DesktopShell — Authenticated chrome for viewports ≥ 768 px (Design §H).
 *
 * Renders the persistent sidebar, top header, breadcrumb trail, and the
 * routed page content. The shell deliberately keeps the same DOM structure
 * the previous `(dashboard)/layout.tsx` produced, so swapping to the
 * `<AppShell>` selector does not change the desktop UX.
 *
 * The mobile counterpart (`<MobileShell>`) shares the same `children`
 * outlet — only the chrome differs — so navigating between viewport
 * widths preserves authentication, locale, theme, and the Sync_Queue
 * (Requirement 41 AC 6).
 *
 * The `<PageErrorBoundary>` wraps only the page content so that a render
 * error inside a page does NOT crash the sidebar or header — the shell
 * chrome remains mounted and the user can click Retry to recover
 * (Property F-9, Requirement 24.x / 38.7).
 */
export function DesktopShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden" data-shell="desktop">
      {/* Sidebar Navigation */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Header */}
        <Header />

        {/* Breadcrumbs + Page Content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Breadcrumbs />
          <PageErrorBoundary>
            <div className="mt-4">{children}</div>
          </PageErrorBoundary>
        </main>
      </div>

      {/* Global Command Palette (⌘K / Ctrl+K) — Task 60A.7 */}
      <CommandPalette />
    </div>
  );
}

export default DesktopShell;
