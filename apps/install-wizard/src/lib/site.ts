/**
 * Install Wizard site helpers (public URLs for footer + complete CTA).
 */

/** Docs / installation guide URL (not an in-app hash stub). */
export function getInstallDocsUrl(): string {
  const docs = process.env.NEXT_PUBLIC_DOCS_URL?.trim();
  if (docs && /^https?:\/\//i.test(docs)) return docs;
  const site = process.env.NEXT_PUBLIC_PUBLIC_WEBSITE_URL?.trim().replace(/\/$/, '');
  if (site && /^https?:\/\//i.test(site)) return `${site}/installation`;
  return 'https://proctira.org/installation';
}

/** Support contact URL. */
export function getInstallSupportUrl(): string {
  const support = process.env.NEXT_PUBLIC_SUPPORT_URL?.trim();
  if (support && (/^https?:\/\//i.test(support) || support.startsWith('mailto:'))) {
    return support;
  }
  return 'mailto:support@proctira.org';
}

/**
 * Post-setup dashboard login lives on the main web app.
 * Prefer `NEXT_PUBLIC_WEB_APP_URL`. Falls back to docs so we never link a dead
 * in-wizard `/login` route.
 */
export function getWebAppLoginUrl(): string {
  const base = process.env.NEXT_PUBLIC_WEB_APP_URL?.trim().replace(/\/$/, '');
  if (base && /^https?:\/\//i.test(base)) {
    return `${base}/login`;
  }
  return getInstallDocsUrl();
}
