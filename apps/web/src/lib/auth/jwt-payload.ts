/**
 * Edge/Node/browser-safe JWT payload decoder (PRC-L254).
 *
 * JWT segments are base64url (RFC 7515 §2) and the JSON is UTF-8. Plain
 * `atob(segment)` throws on '-'/'_' and yields Latin-1 mojibake for
 * non-ASCII claims such as a display name 'अनन्या'.
 *
 * This does NOT verify the signature. The BFF uses decoded claims for UX
 * gating (navigation, SSR shell) only; the API gateway verifies every token
 * it receives, strips client X-Tenant-ID and requires a verified tenant claim,
 * so it is the enforcement point for authorization.
 */
export function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Returns the decoded payload object, or null for a malformed token. */
export function decodeJwtPayload<T = Record<string, unknown>>(token: string): T | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    const payload: unknown = JSON.parse(decodeBase64Url(parts[1]));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    return payload as T;
  } catch {
    return null;
  }
}
