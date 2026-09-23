import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  decodeBase64UrlToBytes,
  decodeBase64UrlToString,
  decodeJwtPayload,
  isJwtFresh,
} from './decode.js';

/** Encode a claim set exactly the way an RFC 7519 issuer does: base64url. */
function mintToken(claims: unknown, alg = 'HS256'): string {
  const header = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.signature-not-verified`;
}

describe('decodeBase64UrlToBytes', () => {
  it('decodes the base64url alphabet that atob() rejects', () => {
    // 0xFB 0xFF encodes to `+/8` in standard base64 and `-_8` in base64url.
    const source = new Uint8Array([0xfb, 0xff]);
    const segment = Buffer.from(source).toString('base64url');
    expect(segment).toBe('-_8');
    expect(() => atob(segment)).toThrow();

    expect(Array.from(decodeBase64UrlToBytes(segment)!)).toEqual([0xfb, 0xff]);
  });

  it('accepts unpadded segments, which is how JWT segments are written', () => {
    const segment = Buffer.from('abcde').toString('base64url');
    expect(segment.endsWith('=')).toBe(false);
    expect(decodeBase64UrlToString(segment)).toBe('abcde');
  });

  it('also accepts the standard alphabet and trailing padding', () => {
    // Deliberate leniency: we read tokens minted elsewhere, and rejecting a
    // decodable one costs a login loop. See the module docblock.
    expect(Array.from(decodeBase64UrlToBytes('+/8=')!)).toEqual([0xfb, 0xff]);
    expect(decodeBase64UrlToString(Buffer.from('abcde').toString('base64'))).toBe('abcde');
    expect(decodeBase64UrlToString(btoa('{"a":1}'))).toBe('{"a":1}');
  });

  it('rejects a segment that mixes the two alphabets', () => {
    // `-` and `+` in one segment means corruption, not a lenient issuer.
    expect(decodeBase64UrlToBytes('a-b+')).toBeNull();
    expect(decodeBase64UrlToBytes('a_b/')).toBeNull();
  });

  it.each([
    ['padding in the middle', 'a=bc'],
    ['whitespace', 'aa a'],
    ['three padding characters', 'a==='],
    ['a character outside both alphabets', 'aa$a'],
  ])('returns null rather than throwing on %s', (_label, segment) => {
    expect(decodeBase64UrlToBytes(segment)).toBeNull();
  });

  it('returns null for a length that no base64 quantum can produce', () => {
    expect(decodeBase64UrlToBytes('a')).toBeNull();
    expect(decodeBase64UrlToBytes('abcde')).toBeNull();
  });

  it('decodes the empty segment to zero bytes', () => {
    expect(Array.from(decodeBase64UrlToBytes('')!)).toEqual([]);
  });
});

describe('decodeBase64UrlToString', () => {
  it('returns null for byte sequences that are not valid UTF-8', () => {
    // A lone continuation byte. Without `fatal` this would become U+FFFD and
    // a corrupt token would look decodable.
    const segment = Buffer.from(new Uint8Array([0x80])).toString('base64url');
    expect(decodeBase64UrlToString(segment)).toBeNull();
  });
});

describe('decodeJwtPayload', () => {
  it('reads an all-ASCII claim set', () => {
    const token = mintToken({ sub: 'u-1', tenantId: 'acme', exp: 42 });
    expect(decodeJwtPayload(token)).toEqual({ sub: 'u-1', tenantId: 'acme', exp: 42 });
  });

  it.each([
    ['Devanagari', 'अनिता राव'],
    ['Arabic', 'مدرسة النور'],
    ['accented Latin', 'Chloé Lefèvre'],
    ['Han', '北京国际学校'],
  ])('reads a claim set whose displayName is %s', (_label, displayName) => {
    const token = mintToken({ sub: 'u-1', displayName, exp: 42 });

    // Guard the premise: the naive decode really does fail on these.
    const payloadSegment = token.split('.')[1]!;
    const naive = (): unknown => JSON.parse(atob(payloadSegment));
    let naiveResult: unknown;
    try {
      naiveResult = naive();
    } catch {
      naiveResult = '<<threw>>';
    }
    expect(naiveResult).not.toEqual({ sub: 'u-1', displayName, exp: 42 });

    expect(decodeJwtPayload(token)).toEqual({ sub: 'u-1', displayName, exp: 42 });
  });

  it('reads a token minted with standard base64 and padding', () => {
    // Shape used by several e2e fixtures in this repo and by non-conformant
    // issuers. Rejecting it would trade one login loop for another.
    const claims = { sub: 'u-1', exp: 42 };
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64');
    expect(payload).toMatch(/=$/);
    expect(decodeJwtPayload(`${header}.${payload}.sig`)).toEqual(claims);
  });

  it('reads a claim set containing ? > and ~, which produce + and / in standard base64', () => {
    // Offsets chosen so the trigger byte lands in each sextet position.
    for (const padding of ['', 'a', 'bb']) {
      const claims = { q: `${padding}?>~`, exp: 42 };
      expect(decodeJwtPayload(mintToken(claims))).toEqual(claims);
    }
  });

  it.each([
    ['not a string', 123 as unknown as string],
    ['no segments', 'abc'],
    ['two segments', 'aaaa.bbbb'],
    ['four segments', 'aaaa.bbbb.cccc.dddd'],
    ['payload outside both base64 alphabets', 'aaaa.not valid.cccc'],
    ['payload not JSON', `aaaa.${Buffer.from('nope').toString('base64url')}.cccc`],
  ])('returns null when the token is %s', (_label, token) => {
    expect(decodeJwtPayload(token)).toBeNull();
  });

  it.each([
    ['null', null],
    ['an array', [1, 2]],
    ['a number', 7],
    ['a string', 'claims'],
  ])('returns null when the payload JSON is %s', (_label, value) => {
    const segment = Buffer.from(JSON.stringify(value)).toString('base64url');
    expect(decodeJwtPayload(`aaaa.${segment}.cccc`)).toBeNull();
  });
});

describe('isJwtFresh', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function at(epochSeconds: number): void {
    vi.useFakeTimers();
    vi.setSystemTime(epochSeconds * 1000);
  }

  it('is true well before expiry', () => {
    at(1_000);
    expect(isJwtFresh(mintToken({ exp: 2_000 }))).toBe(true);
  });

  it('is false after expiry', () => {
    at(2_001);
    expect(isJwtFresh(mintToken({ exp: 2_000 }))).toBe(false);
  });

  it('is false inside the expiry buffer', () => {
    at(1_980); // 20s left, buffer is 30s
    expect(isJwtFresh(mintToken({ exp: 2_000 }))).toBe(false);
  });

  it('honours an explicit buffer', () => {
    at(1_980);
    expect(isJwtFresh(mintToken({ exp: 2_000 }), 5)).toBe(true);
  });

  it('treats a non-numeric or absent exp as fresh', () => {
    at(1_000);
    expect(isJwtFresh(mintToken({ sub: 'u-1' }))).toBe(true);
    expect(isJwtFresh(mintToken({ exp: '2000' }))).toBe(true);
  });

  it('is false for an undecodable token', () => {
    at(1_000);
    expect(isJwtFresh('garbage')).toBe(false);
    expect(isJwtFresh('aaaa.not valid.cccc')).toBe(false);
  });

  it('is true for a token whose exp only survives a base64url-correct decode', () => {
    at(1_000);
    // A displayName that forces `-`/`_` into the encoding.
    const token = mintToken({ displayName: 'Chloé', exp: 2_000 });
    expect(token.split('.')[1]).toMatch(/[-_]/);
    expect(isJwtFresh(token)).toBe(true);
  });
});
