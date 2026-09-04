'use client';

/**
 * MarketingLayout — Public site chrome (Task 50.1, Design §E).
 *
 * Wraps every public marketing page with:
 *
 *   • `<MarketingHeader>` — tenant logo + brand name, primary navigation
 *     (Features, Pricing, About, Contact, Demo), `<LanguageSelector>`,
 *     `<ThemeToggle>`, and the sign-in / get-started CTAs.
 *   • `<MarketingFooter>` — the thirteen-column link footer required by
 *     Requirement 31 AC 2 (Product, Solutions, Developers, Installation,
 *     Plugins, Resources, Company, Contact, Legal, Privacy,
 *     Security/Trust, Status, Language/Region selector).
 *   • `<DocumentTitle>` — sets `document.title` to the configured
 *     `Brand_Name` per the tenant's `document_title_template` so the
 *     browser tab carries the active brand on every public page (Design
 *     §M, Requirement 43.5–6). The page-level title comes from the
 *     `pageTitle` prop; pages that already render their own
 *     `<DocumentTitle>` (e.g., the existing tracking page) can pass
 *     `skipDocumentTitle` to avoid the redundant binding.
 *
 * The layout is anonymous — there is no `<RequireAuth>` boundary because
 * marketing surfaces (and the public registration / tracking flows) must
 * remain reachable without an active session. The language and theme
 * toggles work because `<LanguageProvider>` and `<ThemeProvider>` sit
 * above `<AuthProvider>` in the provider hierarchy (Design §A).
 *
 * Both the heading-only Public layout (`app/(public)/layout.tsx`, used
 * by the Application Tracking page from Task 51.4) and the new
 * `app/(marketing)/layout.tsx` route group below compose this component
 * so a single source of truth governs the public chrome.
 */

import React, { createContext, useContext } from 'react';

import { DocumentTitle } from '@/components/DocumentTitle';
import { MarketingFooter } from './marketing-footer';
import { MarketingHeader } from './marketing-header';

/**
 * True when an ancestor already rendered the marketing chrome. SPA feature
 * pages wrap themselves in `<MarketingLayout>` for the federated router;
 * App Router pages sit under `app/(marketing)/layout.tsx`, which also
 * mounts the chrome. Nested instances therefore render only title +
 * children so header/footer are never duplicated.
 */
const MarketingLayoutNestContext = createContext(false);

export interface MarketingLayoutProps {
  /** Routed page content rendered between the header and the footer. */
  children: React.ReactNode;
  /**
   * Page-specific title fragment (e.g. "Features"). When provided, the
   * layout renders a `<DocumentTitle>` so the browser tab reflects
   * `Brand_Name` per the tenant's configured template. Required by
   * Task 50.1 sub-bullet "wrap every page in `<DocumentTitle>`" and by
   * Requirement 43 AC 5–6.
   */
  pageTitle?: string;
  /**
   * Per-page override for the document-title template. Same `{page}` /
   * `{brand}` placeholders as the tenant-default template; useful for
   * landing pages that want a brand-first format (`"{brand} — {page}"`).
   */
  documentTitleTemplate?: string;
  /**
   * Skip the embedded `<DocumentTitle>`. Set this when the page already
   * renders its own (`app/(public)/track/page.tsx` does this so the
   * server-rendered `t('tracking.title')` keeps SSR-meaningful titles
   * before the brand fetch resolves).
   */
  skipDocumentTitle?: boolean;
  /** Override the footer year — used by tests for deterministic snapshots. */
  footerYear?: number;
}

/**
 * Top-level wrapper. The flex column ensures the footer hugs the bottom
 * of the viewport on short pages while still flowing naturally on long
 * ones.
 */
export function MarketingLayout({
  children,
  pageTitle,
  documentTitleTemplate,
  skipDocumentTitle = false,
  footerYear,
}: MarketingLayoutProps) {
  const isNested = useContext(MarketingLayoutNestContext);

  const title =
    !skipDocumentTitle && pageTitle ? (
      <DocumentTitle pageTitle={pageTitle} template={documentTitleTemplate} />
    ) : null;

  if (isNested) {
    return (
      <>
        {title}
        {children}
      </>
    );
  }

  return (
    <MarketingLayoutNestContext.Provider value={true}>
      <div
        data-shell="marketing-layout"
        className="flex min-h-screen flex-col bg-[hsl(var(--background))] text-[hsl(var(--foreground))]"
      >
        {/* Brand-aware document title binding. Skipped when the page
            already mounts its own to avoid a flicker between two competing
            title sources. */}
        {title}

        <MarketingHeader />

        {/* `flex-1` so the footer is pushed to the bottom on short pages.
            Pages own their own `<main>` semantics inside this slot — the
            layout intentionally does not impose a `<main>` element so that
            marketing pages can render hero sections, etc., as siblings if
            they need to. */}
        <div className="flex flex-1 flex-col">{children}</div>

        <MarketingFooter year={footerYear} />
      </div>
    </MarketingLayoutNestContext.Provider>
  );
}

export default MarketingLayout;
