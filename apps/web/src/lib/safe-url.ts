/**
 * Scheme allow-list for user-supplied URLs (PRC-H024 / PRC-H033).
 *
 * React does not block `javascript:` (or `data:` / `vbscript:`) hrefs, so any
 * URL that came from user input must pass through here before it becomes an
 * `href`, and must be validated with {@link isHttpUrl} at the write boundary.
 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
/** True when `value` is an absolute http(s) URL. */
export function isHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  // Reject control characters / whitespace that browsers strip before scheme parsing.
  if (trimmed.length === 0 || /\s/.test(trimmed) || hasControlChar(trimmed)) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  return ALLOWED_PROTOCOLS.has(parsed.protocol) && parsed.hostname.length > 0;
}

/** Returns a safe href for http(s) URLs, or `null` so callers render plain text instead. */
export function safeHref(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  return isHttpUrl(value) ? new URL(value.trim()).href : null;
}
