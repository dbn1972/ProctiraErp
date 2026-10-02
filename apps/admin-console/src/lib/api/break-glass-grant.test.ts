import { describe, expect, it, vi } from 'vitest';

vi.mock('./gateway', () => ({ gatewayFetch: vi.fn() }));

import { hasActiveBreakGlassGrant, type BreakGlassRequest } from './break-glass';

/** PRC-H003: masquerade needs an active, unexpired grant for this operator (matched on sub). */
const now = new Date('2026-01-01T10:00:00Z');
const base: BreakGlassRequest = {
  id: 'bg_1',
  requester: 'op@proctira.org',
  requesterSub: 'sub-op',
  targetTenantId: 'tnt_1',
  scope: 'read',
  justification: 'x'.repeat(30),
  useCase: 'Production incident triage',
  durationMinutes: 30,
  status: 'active',
  createdAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + 60_000).toISOString(),
};
const me = { sub: 'sub-op', email: 'op@proctira.org' };

describe('hasActiveBreakGlassGrant', () => {
  it('accepts an active, unexpired grant for the same subject and tenant', () => {
    expect(hasActiveBreakGlassGrant([base], 'tnt_1', me, now)).toBe(true);
  });

  it('rejects expired, revoked, other-tenant and other-subject grants', () => {
    const expired = { ...base, expiresAt: now.toISOString() };
    expect(hasActiveBreakGlassGrant([expired], 'tnt_1', me, now)).toBe(false);
    expect(hasActiveBreakGlassGrant([{ ...base, status: 'revoked' }], 'tnt_1', me, now)).toBe(
      false,
    );
    expect(hasActiveBreakGlassGrant([base], 'tnt_2', me, now)).toBe(false);
    // Same email but a different verified subject must not match.
    expect(
      hasActiveBreakGlassGrant([base], 'tnt_1', { sub: 'sub-other', email: me.email }, now),
    ).toBe(false);
    expect(hasActiveBreakGlassGrant([{ ...base, expiresAt: undefined }], 'tnt_1', me, now)).toBe(
      false,
    );
  });

  it('falls back to email only for legacy rows without requesterSub', () => {
    const legacy = { ...base, requesterSub: undefined };
    expect(hasActiveBreakGlassGrant([legacy], 'tnt_1', me, now)).toBe(true);
  });
});
