/**
 * apps/web/src/lib/sync/idempotencyKey.ts — UUID v4 generator
 * (Task 54.2, Requirements 38.5, 38.6, 38.7, Design §I)
 * =====================================================================
 *
 * Every queued write operation in the Sync_Queue carries an
 * `Idempotency-Key` header so the API_Gateway (task 54.6) can
 * deduplicate retries when the Frontend_Shell replays the queue on
 * reconnection. The key MUST be:
 *
 *   • Unique per logical operation (a retry of the same operation
 *     reuses the same key; a fresh submission gets a new one).
 *   • A v4 UUID — wide vendor support, sufficient entropy
 *     (122 random bits) to avoid collisions across tenants.
 *   • Generated on the client at enqueue time so the key survives
 *     a browser restart in IndexedDB.
 *
 * Implementation strategy:
 *
 *   1. Prefer `crypto.randomUUID()` when present (modern browsers and
 *      Node ≥ 19). It is implemented natively, uses a CSPRNG, and is
 *      already RFC 4122 §4.4 compliant.
 *
 *   2. Fall back to `crypto.getRandomValues()` filling a 16-byte buffer
 *      and stamping the version (`0100`) and variant (`10xx`) bits.
 *      This branch only runs on legacy runtimes.
 *
 *   3. Last-resort fallback to `Math.random()`. This is NOT
 *      cryptographically secure but the queue still functions for
 *      idempotency purposes (the gateway only needs unique keys, not
 *      unguessable ones). We log nothing here so the function stays
 *      synchronous and side-effect free.
 *
 * The module exports a single function `generateIdempotencyKey()` so
 * callers do not have to know about the platform-detection logic.
 */

/** Minimal `crypto` shape we rely on. Shrunk so the module runs in
 * Node, browser, and worker environments without DOM types. */
type CryptoLike = {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T;
};

/**
 * Resolve the `crypto` global without triggering ReferenceErrors in
 * runtimes that omit it (very old browsers, sandboxed test workers).
 */
function getCrypto(): CryptoLike | undefined {
  if (typeof globalThis === 'undefined') return undefined;
  return (globalThis as { crypto?: CryptoLike }).crypto;
}

/**
 * Generate a v4 UUID suitable for use as an `Idempotency-Key`.
 *
 * Format: `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx` where `y` is one of
 * `8`, `9`, `a`, `b` (per RFC 4122 §4.4).
 *
 * The function is synchronous and has no side effects so it can be
 * called from inside reducers / React render paths if needed.
 */
export function generateIdempotencyKey(): string {
  const c = getCrypto();

  // Path 1 — native randomUUID. Already RFC 4122 v4.
  if (c?.randomUUID) return c.randomUUID();

  // Path 2 — getRandomValues + manual stamping. The version/variant
  // bits live at fixed octets per the spec.
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    // Path 3 — Math.random fallback. Acceptable for idempotency
    // because the gateway only needs uniqueness, not unpredictability.
    for (let i = 0; i < 16; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // Set version (4) in the high nibble of byte 6:  0100xxxx
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  // Set variant (10xx) in the high two bits of byte 8:  10xxxxxx
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  // Render as the canonical 8-4-4-4-12 hex string.
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return (
    `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-` +
    `${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-` +
    `${hex.slice(10, 16).join('')}`
  );
}

/**
 * Validate that a string matches the v4 UUID layout. Used by tests
 * and by defensive code that accepts pre-generated keys from callers
 * (for example, when a caller wants to correlate the queued op with
 * its own client-side state).
 */
export function isValidIdempotencyKey(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
