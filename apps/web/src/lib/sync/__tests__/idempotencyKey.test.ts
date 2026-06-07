/**
 * apps/web/src/lib/sync/__tests__/idempotencyKey.test.ts
 * (Task 54.2, Requirements 38.5, 38.6, 38.7)
 * =====================================================================
 *
 * Verifies the v4 UUID generator used as the `Idempotency-Key` for
 * every queued sync operation. Three branches must work:
 *
 *   1. The native `crypto.randomUUID` fast path.
 *   2. The `crypto.getRandomValues` + manual stamping fallback for
 *      runtimes that ship `crypto` but not `randomUUID`.
 *   3. The `Math.random` last-resort fallback used when no `crypto`
 *      object exists at all.
 *
 * Each branch must produce a string matching the canonical RFC 4122
 * v4 layout. We also assert that consecutive calls produce different
 * values (collision is possible at 122 bits but vanishingly so).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  generateIdempotencyKey,
  isValidIdempotencyKey,
} from '../idempotencyKey';

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// We mutate `globalThis.crypto` to drive the three code paths. Save
// the original so the mutations cannot leak between tests.
const ORIGINAL_CRYPTO = (globalThis as { crypto?: unknown }).crypto;

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    writable: true,
    value: ORIGINAL_CRYPTO,
  });
});

describe('generateIdempotencyKey — native crypto.randomUUID path', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      writable: true,
      value: {
        randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      },
    });
  });

  it('delegates to crypto.randomUUID when available', () => {
    expect(generateIdempotencyKey()).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  });
});

describe('generateIdempotencyKey — getRandomValues fallback', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      writable: true,
      value: {
        // Predictable bytes (all 0xff) so we can verify the version /
        // variant nibbles are stamped correctly.
        getRandomValues: (arr: Uint8Array) => {
          for (let i = 0; i < arr.length; i += 1) arr[i] = 0xff;
          return arr;
        },
      },
    });
  });

  it('produces a UUID matching the v4 layout', () => {
    const key = generateIdempotencyKey();
    expect(key).toMatch(UUID_V4_REGEX);
  });

  it('stamps version (4) and variant (10xx) bits even when input is all-ones', () => {
    const key = generateIdempotencyKey();
    // The 13th character (after three groups of 4 + dashes) is the
    // version nibble — must be `4`.
    expect(key[14]).toBe('4');
    // The 19th character is the variant nibble — must be one of
    // 8/9/a/b.
    expect('89ab').toContain(key[19]!.toLowerCase());
  });
});

describe('generateIdempotencyKey — Math.random last-resort fallback', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      writable: true,
      value: undefined,
    });
  });

  it('still returns a valid v4 UUID without any crypto API', () => {
    const key = generateIdempotencyKey();
    expect(key).toMatch(UUID_V4_REGEX);
  });

  it('returns distinct values on repeated calls', () => {
    const a = generateIdempotencyKey();
    const b = generateIdempotencyKey();
    const c = generateIdempotencyKey();
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe('isValidIdempotencyKey', () => {
  it('accepts canonical v4 UUIDs', () => {
    expect(isValidIdempotencyKey('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')).toBe(
      true,
    );
    expect(isValidIdempotencyKey('00000000-0000-4000-8000-000000000000')).toBe(
      true,
    );
  });

  it('rejects strings with the wrong version nibble', () => {
    // Version `1` instead of `4`.
    expect(isValidIdempotencyKey('aaaaaaaa-bbbb-1ccc-8ddd-eeeeeeeeeeee')).toBe(
      false,
    );
  });

  it('rejects strings with the wrong variant nibble', () => {
    // Variant `c` instead of 8/9/a/b.
    expect(isValidIdempotencyKey('aaaaaaaa-bbbb-4ccc-cddd-eeeeeeeeeeee')).toBe(
      false,
    );
  });

  it('rejects empty and malformed strings', () => {
    expect(isValidIdempotencyKey('')).toBe(false);
    expect(isValidIdempotencyKey('not-a-uuid')).toBe(false);
    expect(isValidIdempotencyKey('aaaaaaaa-bbbb-4ccc-8ddd')).toBe(false);
  });
});
