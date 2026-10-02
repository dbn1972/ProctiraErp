import { describe, expect, it } from 'vitest';
import { decodeJwtPayload } from './jwt-payload';
import { decodeTokenPayload } from './session';

function token(payload: unknown): string {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.c2ln`;
}

describe('JWT payload decoding (PRC-L254)', () => {
  it("decodes a UTF-8 display name 'अनन्या'", () => {
    const decoded = decodeTokenPayload(token({ sub: 'u1', displayName: 'अनन्या', exp: 1 }));
    expect(decoded?.displayName).toBe('अनन्या');
  });

  it('decodes base64url payloads containing - and _ characters', () => {
    // '?>' and '~' push the encoding into the url-safe alphabet.
    const raw = token({ sub: 'u1', note: '??>>~~ÿ' });
    expect(raw.split('.')[1]).toMatch(/[-_]/);
    expect(decodeJwtPayload<{ note: string }>(raw)?.note).toBe('??>>~~ÿ');
  });

  it('rejects malformed tokens and non-object payloads', () => {
    expect(decodeJwtPayload('a.b')).toBeNull();
    expect(decodeJwtPayload('h.!!!.s')).toBeNull();
    expect(decodeJwtPayload(token('just a string'))).toBeNull();
    expect(decodeJwtPayload(token([1, 2]))).toBeNull();
  });
});
