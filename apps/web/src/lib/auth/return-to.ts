/**
 * Sanitize post-auth redirect targets to same-origin relative paths only.
 *
 * Rejects absolute URLs, protocol-relative URLs (`//evil.com`), backslash
 * tricks, and other open-redirect vectors before login / MFA / OAuth
 * handlers navigate the browser.
 */
export function sanitizeReturnTo(raw: string | null | undefined, fallback = '/'): string {
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
  // Control characters (incl. tab/CR/LF) and DEL are stripped by WHATWG URL
  // parsers, so `/\t/evil.com` would collapse into `//evil.com` (PRC-M064).
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  if (/^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return false;
  // Final guard: resolving against a sentinel origin must stay same-origin.
  try {
    const resolved = new URL(value, 'http://sentinel.invalid');
    if (resolved.origin !== 'http://sentinel.invalid' || !resolved.pathname.startsWith('/')) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}
