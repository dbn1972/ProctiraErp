/**
 * Gateway path hardening (PRC-L232 / PRC-L241).
 *
 * Server actions and `lib/api` helpers interpolate ids into gateway paths.
 * `fetch` normalises dot-segments, so an unvalidated `../../plugins/x` would
 * silently retarget the request at another resource. Two layers stop that:
 *
 * 1. {@link gatewayPath} — tagged template that `encodeURIComponent`s every
 *    interpolated value, so a value can never add a segment or a query.
 * 2. {@link isSafeGatewayPath} — enforced by `gatewayFetch` /
 *    `browserGatewayFetch` for every request: no `.`/`..` segment (raw or
 *    percent-encoded), no encoded `/` or `\` inside a segment, no control chars.
 */

/** Builds a path, percent-encoding each interpolated value as one segment component. */
export function gatewayPath(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0] ?? '';
  values.forEach((value, index) => {
    out += encodeURIComponent(String(value)) + (strings[index + 1] ?? '');
  });
  return out;
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** True when `path` (relative gateway path, optional query) cannot traverse to another resource. */
export function isSafeGatewayPath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0) return false;
  const pathname = path.split(/[?#]/, 1)[0] ?? '';
  if (hasControlChar(pathname) || pathname.includes('\\')) return false;
  for (const segment of pathname.split('/')) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return false;
    }
    if (decoded === '.' || decoded === '..') return false;
    if (decoded.includes('/') || decoded.includes('\\') || hasControlChar(decoded)) return false;
  }
  return true;
}
