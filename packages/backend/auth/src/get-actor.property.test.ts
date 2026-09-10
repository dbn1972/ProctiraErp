/**
 * Property: forgeable actor headers must not change getActor output (G-102).
 *
 * For any JWT user and any values of x-user-id / x-actor / x-actor-id / x-userid,
 * getActor(request) MUST equal getActor({ user }) — headers are ignored.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { RoleAssignment } from '@proctira/auth';

import { getActor } from './get-actor.js';

const roleArb: fc.Arbitrary<RoleAssignment> = fc.record({
  roleId: fc.string({ minLength: 1, maxLength: 24 }),
  roleName: fc.string({ minLength: 1, maxLength: 24 }),
  areaId: fc.uuid(),
  institutionId: fc.option(fc.uuid(), { nil: undefined }),
});

const jwtUserArb = fc.record({
  sub: fc.uuid(),
  tenantId: fc.uuid(),
  roles: fc.array(roleArb, { maxLength: 4 }),
});

const forgeableHeaderNameArb = fc.constantFrom(
  'x-user-id',
  'x-actor',
  'x-actor-id',
  'x-userid',
  'X-User-Id',
  'X-ACTOR',
  'X-Actor-Id',
  'X-UserId',
);

const headerValueArb = fc.oneof(fc.uuid(), fc.string({ minLength: 1, maxLength: 64 }));

describe('getActor (G-102 JWT-only actors)', () => {
  it('setting forgeable actor headers does not change the actor returned by getActor', () => {
    fc.assert(
      fc.property(
        jwtUserArb,
        fc.dictionary(forgeableHeaderNameArb, headerValueArb, { minKeys: 0, maxKeys: 4 }),
        (user, forgeableHeaders) => {
          const baseline = getActor({ user });
          const withHeaders = getActor({
            user,
            headers: {
              ...forgeableHeaders,
              'content-type': 'application/json',
            },
          });
          expect(withHeaders).toEqual(baseline);
          expect(withHeaders.userId).toBe(user.sub);
          expect(withHeaders.tenantId).toBe(user.tenantId);
          expect(withHeaders.roles).toEqual(user.roles);
          // Explicitly: forged header values must never become userId
          for (const value of Object.values(forgeableHeaders)) {
            if (value !== user.sub) {
              expect(withHeaders.userId).not.toBe(value);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('returns empty actor fields when JWT user is absent (headers still ignored)', () => {
    fc.assert(
      fc.property(headerValueArb, (forged) => {
        const actor = getActor({
          headers: {
            'x-user-id': forged,
            'x-actor': forged,
            'x-actor-id': forged,
            'x-userid': forged,
          },
        });
        expect(actor).toEqual({ userId: '', tenantId: '', roles: [] });
      }),
      { numRuns: 50 },
    );
  });
});
