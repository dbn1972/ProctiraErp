/**
 * Sanitize post-auth redirect targets to same-origin relative paths only.
 *
 * Rejects absolute URLs, protocol-relative URLs (`//evil.com`), backslash
 * tricks, and other open-redirect vectors before login / MFA / OAuth
 * handlers navigate the browser.
 */
export function sanitizeReturnTo(
  raw: string | null | undefined,
  fallback = '/',
): string {
  if (raw == null || raw === '') {
    return fallback;
  }

  const candidate = raw.trim();
  if (!isSafeRelativePath(candidate)) {
    return fallback;
  }

  try {
    const decoded = decodeURIComponent(candidate);
    if (!isSafeRelativePath(decoded)) {
      return fallback;
    }
  } catch {
    return fallback;
  }

  return candidate;
}

function isSafeRelativePath(value: string): boolean {
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//') || value.startsWith('/\\')) return false;
  if (value.includes('\\')) return false;
  // Block scheme-looking prefixes after the leading slash, e.g. `/javascript:...`
  // is already a path, but `/\t/evil` style oddities are caught by startsWith checks.
  if (/^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return false;
  return true;
}
