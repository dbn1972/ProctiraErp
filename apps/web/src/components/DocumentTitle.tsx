'use client';

/**
 * <DocumentTitle> — Public document title binding (Design §M, Task 57.2)
 *
 * Sets `document.title` from the current tenant brand and the page-supplied
 * `pageTitle`, satisfying Requirement 43 AC 5–6 (configurable Brand_Name in
 * the document `<title>` element, applied across all surfaces on the next
 * page load without redeployment).
 *
 *   <DocumentTitle pageTitle="Track Your Application" />
 *
 * Behaviors:
 *
 *   1. **Template resolution.** Reads `document_title_template` from
 *      `useBrand()` and substitutes the `{page}` and `{brand}` placeholders.
 *      The default template (`"{page} | {brand}"`) yields `"Track Your
 *      Application | ProctiraERP"`. Tenants can override the template (e.g.,
 *      `"{page} · {brand}"` or `"{brand} — {page}"`) via the branding API
 *      and the next render picks it up automatically.
 *
 *   2. **Loading fallback.** While the brand boot fetch is still in flight
 *      the component sets `document.title` to the bare `pageTitle` so the
 *      browser tab is never branded with a stale or empty value.
 *
 *   3. **Effect-only.** Renders no DOM. All work happens inside `useEffect`,
 *      which means:
 *        - It is SSR-safe (the hook is a no-op on the server).
 *        - It runs on every navigation (the page-supplied title changes
 *          and the effect dependencies trigger a re-application).
 *
 *   4. **Defensive against unbalanced placeholders.** If a tenant uploads
 *      a template that omits `{page}` we still surface the brand-only
 *      fallback rather than blanking the tab.
 */

import { useEffect } from 'react';

import { useBrand } from '@/providers/BrandConfigProvider';

export interface DocumentTitleProps {
  /** Page-specific title fragment, e.g. "Track Your Application". */
  pageTitle: string;
  /**
   * Optional template override for one-off pages that need a different
   * format than the tenant default. Same `{page}` / `{brand}` placeholders
   * apply.
   */
  template?: string;
}

/**
 * Resolve the final document title from a template, page title, and brand
 * name. Pure function so it can be unit-tested without a DOM.
 *
 * Substitutes `{page}` → `pageTitle` and `{brand}` → `brandName`. If the
 * template is empty or has no placeholders we fall back to
 * `"${pageTitle} | ${brandName}"` (Design §M default) so the tab is never
 * left as a literal `"{page} | {brand}"` string.
 */
export function resolveDocumentTitle(
  template: string | undefined,
  pageTitle: string,
  brandName: string,
): string {
  const trimmedPage = pageTitle.trim();
  const trimmedBrand = brandName.trim();
  const tpl = (template ?? '').trim();

  // Empty template — use the canonical Design §M default.
  if (tpl.length === 0) {
    if (trimmedPage.length === 0) return trimmedBrand;
    if (trimmedBrand.length === 0) return trimmedPage;
    return `${trimmedPage} | ${trimmedBrand}`;
  }

  // Template with no recognised placeholders is treated as malformed and we
  // fall back to the default joined string. This matches the spirit of
  // Requirement 43 AC 6 — the next page load surfaces a sensible title even
  // if a tenant misconfigures the template.
  if (!tpl.includes('{page}') && !tpl.includes('{brand}')) {
    return trimmedBrand.length === 0
      ? trimmedPage
      : `${trimmedPage} | ${trimmedBrand}`;
  }

  return tpl
    .replace(/\{page\}/g, trimmedPage)
    .replace(/\{brand\}/g, trimmedBrand)
    .trim();
}

/**
 * Sets `document.title` on every navigation from the resolved template.
 * Renders no DOM.
 */
export function DocumentTitle({ pageTitle, template }: DocumentTitleProps): null {
  const { name, document_title_template, loading } = useBrand();

  useEffect(() => {
    if (typeof document === 'undefined') return;

    // While the brand boot fetch is in flight we keep the tab title
    // unbranded so it can never display a stale fallback as if it were
    // the tenant's chosen brand.
    if (loading) {
      document.title = pageTitle;
      return;
    }

    const resolvedTemplate = template ?? document_title_template;
    document.title = resolveDocumentTitle(resolvedTemplate, pageTitle, name);
  }, [pageTitle, template, name, document_title_template, loading]);

  return null;
}

export default DocumentTitle;
