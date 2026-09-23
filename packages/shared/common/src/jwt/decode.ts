/**
 * Signature-free JWT payload decoding, correct for base64url and UTF-8.
 *
 * Every client and edge-runtime caller that needs to read `exp`, `tenantId` or
 * `roles` out of an access token must use this module rather than calling
 * `atob()` directly. Two things go wrong with the naive version:
 *
 * 1. **Alphabet.** RFC 7519 mandates base64url (RFC 4648 §5) for JWT segments,
 *    which uses `-` and `_` where standard base64 uses `+` and `/`, and drops
 *    the `=` padding. `atob()` implements *standard* base64 and throws
 *    `InvalidCharacterError` the moment it meets a `-` or `_`.
 *
 * 2. **Encoding.** `atob()` yields a "binary string" — one code unit per byte.
 *    JSON payloads are UTF-8, so any multi-byte character (a school named
 *    `अनिता विद्यालय`, a user named `Chloé`) comes back as mojibake even when
 *    the alphabet happens not to trip (1).
 *
 * Because JSON payloads are overwhelmingly ASCII, `+`/`/` only appear in the
 * encoding when the payload contains a byte whose low six bits are `111110` or
 * `111111` at an offset that lands in the fourth sextet — in practice `?`, `>`,
 * `~`, or any byte of a UTF-8 multi-byte sequence. So the naive decode survives
 * an all-ASCII, punctuation-free payload and fails on non-Latin tenant and
 * person names. That is precisely the population this platform serves, and the
 * failure is silent: the decode throws, the caller's `catch` returns
 * `null`/`false`, and the request is treated as unauthenticated.
 *
 * No dependencies, no Node built-ins: safe for the Next.js edge runtime, the
 * browser, and the server.
 */

/** The base64url alphabet (RFC 4648 §5), padding optional. */
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+={0,2}$|^$/;
/** The standard base64 alphabet (RFC 4648 §4), padding optional. */
const BASE64_STANDARD_SEGMENT = /^[A-Za-z0-9+/]+={0,2}$|^$/;

/**
 * Decodes a base64 segment to raw bytes, accepting either the base64url
 * alphabet (what RFC 7519 requires of a JWT) or the standard one, with or
 * without `=` padding.
 *
 * The leniency is deliberate. This function *reads* tokens that were minted
 * elsewhere — our auth-service, Keycloak, a customer's OIDC provider — and the
 * cost of the two failure modes is wildly asymmetric. Accepting a standard-
 * alphabet segment costs nothing: the bytes are unambiguous and the signature
 * was already verified upstream. Rejecting one produces a redirect to `/login`
 * on every navigation, i.e. an un-loggable-in user, which is the exact defect
 * this module exists to remove. Non-conformant issuers that emit padded or
 * standard-alphabet segments do exist; a strict reader turns their tokens into
 * a login loop for no security gain.
 *
 * A segment mixing the two alphabets (`-` alongside `+`) is corrupt rather than
 * merely non-conformant, and is rejected.
 *
 * Returns `null` — never throws — on any invalid input.
 */
export function decodeBase64UrlToBytes(segment: string): Uint8Array | null {
  const isUrlAlphabet = BASE64URL_SEGMENT.test(segment);
  if (!isUrlAlphabet && !BASE64_STANDARD_SEGMENT.test(segment)) return null;

  const unpadded = segment.replace(/=+$/, '');
  // A base64 quantum is 4 characters encoding 3 bytes; remainders of 2 and 3
  // encode 1 and 2 bytes. A remainder of 1 encodes nothing and cannot occur.
  const remainder = unpadded.length % 4;
  if (remainder === 1) return null;

  const base64 =
    unpadded.replace(/-/g, '+').replace(/_/g, '/') +
    (remainder === 0 ? '' : '='.repeat(4 - remainder));

  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decodes a base64url segment to a UTF-8 string, or `null` when the segment is
 * not valid base64url or not valid UTF-8.
 */
export function decodeBase64UrlToString(segment: string): string | null {
  const bytes = decodeBase64UrlToBytes(segment);
  if (!bytes) return null;
  try {
    // `fatal` so that invalid UTF-8 is reported rather than silently replaced
    // with U+FFFD, which would turn a corrupt token into a parseable one.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Reads the payload of a JWT **without verifying its signature**.
 *
 * Callers must already have established trust in the token by other means (an
 * HttpOnly cookie set by our own origin, an upstream gateway that verified the
 * signature). This is for reading claims, not for authorising anything.
 *
 * Returns `null` when the token is not three dot-separated segments, when the
 * payload segment is not valid base64url UTF-8, or when it does not decode to
 * a JSON object. A JSON payload of `null`, an array, a number or a string is
 * rejected: no JWT claim set is legal in those shapes, and returning one would
 * push the type error onto every caller.
 */
export function decodeJwtPayload<T = Record<string, unknown>>(token: string): T | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const json = decodeBase64UrlToString(parts[1] ?? '');
  if (json === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as T;
}

/** Seconds of slack allowed before a token is treated as expired. */
export const JWT_EXPIRY_BUFFER_SECONDS = 30;

/**
 * Returns true when the token's `exp` claim is still in the future, allowing
 * `bufferSeconds` of clock slack.
 *
 * An undecodable token is **not** fresh. A token with no `exp` is treated as
 * fresh, matching the callers this replaces: tokens are minted by our own
 * auth-service, which always sets `exp`, and the gateway rejects anything that
 * does not verify, so absence of `exp` is a structural oddity rather than an
 * expiry signal.
 */
export function isJwtFresh(token: string, bufferSeconds = JWT_EXPIRY_BUFFER_SECONDS): boolean {
  const payload = decodeJwtPayload<{ exp?: unknown }>(token);
  if (!payload) return false;
  if (typeof payload.exp !== 'number') return true;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return payload.exp - bufferSeconds > nowSeconds;
}
