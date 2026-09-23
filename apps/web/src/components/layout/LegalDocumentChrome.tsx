'use client';
/**
 * Minimal chrome for a standalone legal document.
 *
 * ## Why this is not `<MarketingLayout>`
 *
 * The legal components were written for the marketing surface and wrap themselves in
 * `<MarketingLayout>`, which composes `MarketingHeader` and a thirteen-column
 * `MarketingFooter`. That chrome carries 45 link targets with no route in this app
 * (`/features`, `/pricing`, `/docs/api`, `/solutions/ministries`, `/legal/dpa`, …) because
 * `app/(marketing)/` has a layout and no `page.tsx` — the whole surface is unrouted
 * SPA-era code, and `apps/public-website` owns marketing.
 *
 * Routing a legal document through it would have made all 45 reachable, on the one page
 * where a dead link matters most: the footer's own "Legal" and "Privacy" columns are half
 * dead. A consent document should also not be a navigation surface — it has one job.
 *
 * So the routed `/legal/*` pages get this instead: the tenant brand, a way back, and the
 * document. Every link here resolves, which is what keeps the dead-link gate meaningful
 * rather than dependent on an exclusion list.
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { DocumentTitle } from '@/components/DocumentTitle';
import { useBrand } from '@/providers/BrandConfigProvider';

export function LegalDocumentChrome({
  children,
  pageTitle,
  /** Where "Back" goes. Defaults to sign-in, the surface that links here. */
  backHref = '/login',
  backLabel = 'Back to sign in',
}: {
  children: React.ReactNode;
  pageTitle: string;
  backHref?: string;
  backLabel?: string;
}): JSX.Element {
  const { brand } = useBrand();
  return (
    <div className="flex min-h-screen flex-col bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      <DocumentTitle pageTitle={pageTitle} />
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-6 py-4 lg:px-8">
          {/* Brand comes from useBrand(), never a literal, so a white-label
              deployment renames it without touching this file. */}
          <span className="text-lg font-semibold tracking-tight">{brand.name}</span>
          <Link
            href={backHref}
            className="inline-flex min-h-12 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {backLabel}
          </Link>
        </div>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}

export default LegalDocumentChrome;
