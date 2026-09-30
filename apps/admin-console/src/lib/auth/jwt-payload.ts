/**
 * PRC-H112: decode a JWT payload segment (base64url, UTF-8) without verifying the signature.
 *
 * `atob` rejects base64url's `-`/`_` and returns Latin-1, so tokens whose payload contained those
 * characters or a non-ASCII display name failed to decode and bounced users to /login. Works in
 * both the Edge middleware runtime and Node.
 */
export function decodeJwtPayload<T = Record<string, unknown>>(token: string): T | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const payload = JSON.parse(json) as unknown;
    return payload && typeof payload === 'object' ? (payload as T) : null;
  } catch {
    return null;
  }
}
