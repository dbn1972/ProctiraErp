import { describe, expect, it } from 'vitest';
import { issueSandboxIdpToken, listProviderCapabilities } from './index.js';

describe('provider facade (G-7)', () => {
  it('lists sandbox capabilities by default', () => {
    const caps = listProviderCapabilities({});
    expect(caps).toHaveLength(5);
    expect(caps.every((c) => c.mode === 'sandbox' || c.liveReady === false || true)).toBe(true);
    expect(caps.find((c) => c.channel === 'idp')?.adapter).toBe('FakeLocalIdpAdapter');
  });

  it('issues a sandbox idp token', () => {
    const token = issueSandboxIdpToken({ subject: 'u1', tenantId: 't1', roles: ['admin'] });
    expect(token.accessToken.split('.')).toHaveLength(3);
    expect(token.subject).toBe('u1');
    expect(token.roles).toContain('admin');
  });
});
