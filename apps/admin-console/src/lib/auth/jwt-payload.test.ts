import { describe, expect, it } from 'vitest';

import { decodeJwtPayload } from './jwt-payload';

function tokenFor(payload: object): string {
  const b64url = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `h.${b64url}.s`;
}

describe('decodeJwtPayload (PRC-H112)', () => {
  it('decodes base64url payloads containing - and _ and a unicode display name', () => {
    // '>>>' / '???' in the JSON produce '-' / '_' characters in base64url.
    const payload = {
      sub: 'u1',
      displayName: 'Zoë Ñúñez 李雷',
      note: '>>>???>>>',
      exp: 4102444800,
    };
    const token = tokenFor(payload);
    expect(token.split('.')[1]).toMatch(/[-_]/);
    expect(decodeJwtPayload(token)).toEqual(payload);
  });

  it('returns null for malformed tokens', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload('a.%%%.c')).toBeNull();
    expect(decodeJwtPayload(`a.${Buffer.from('"str"').toString('base64url')}.c`)).toBeNull();
  });
});
