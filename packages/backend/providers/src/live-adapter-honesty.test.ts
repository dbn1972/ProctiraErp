/**
 * W2-INT-03: live delivery adapters must not report success / liveReady
 * when only stubs exist (credentials alone ≠ live adapter).
 */
import { describe, expect, it } from 'vitest';

import { listProviderCapabilities } from './index.js';

describe('W2-INT-03 live delivery adapter honesty', () => {
  it('does not claim liveReady for SMS/email/push/PSP when only env credentials exist', () => {
    const caps = listProviderCapabilities({
      PROVIDER_MODE: 'live',
      TWILIO_AUTH_TOKEN: 'tok',
      SMTP_URL: 'smtp://localhost',
      FCM_SERVER_KEY: 'key',
      PSP_API_KEY: 'pk_test',
      KEYCLOAK_URL: 'https://idp.example',
    });

    for (const channel of ['sms', 'email', 'push', 'psp'] as const) {
      const cap = caps.find((c) => c.channel === channel);
      expect(cap, channel).toBeDefined();
      expect(cap!.liveReady, channel).toBe(false);
      expect(cap!.mode, channel).toBe('sandbox');
      expect(cap!.notes.toLowerCase()).toMatch(/not implemented|stub|sandbox/);
    }
  });

  it('still lists sandbox defaults without credentials', () => {
    const caps = listProviderCapabilities({});
    expect(caps.every((c) => c.mode === 'sandbox')).toBe(true);
    expect(caps.every((c) => c.liveReady === false)).toBe(true);
  });
});
