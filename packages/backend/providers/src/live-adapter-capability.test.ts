/**
 * PRC-M326 (DR36/DR50): a channel reports live only when PROVIDER_MODE=live and the
 * chosen adapter's full credential set is configured (names only; no secret values).
 */
import { describe, expect, it } from 'vitest';
import { LIVE_ADAPTER_ENV, listProviderCapabilities } from './index.js';

const FULL: Record<string, string> = {
  PROVIDER_MODE: 'live',
  RAZORPAY_KEY_ID: 'rzp_test_x',
  RAZORPAY_KEY_SECRET: 'x',
  RAZORPAY_WEBHOOK_SECRET: 'x',
  MSG91_AUTH_KEY: 'x',
  MSG91_TEMPLATE_ID: 'x',
  SES_REGION: 'ap-south-1',
  SES_FROM_ADDRESS: 'no-reply@school.example',
  AWS_ACCESS_KEY_ID: 'x',
  AWS_SECRET_ACCESS_KEY: 'x',
  FCM_PROJECT_ID: 'x',
  FCM_CLIENT_EMAIL: 'x',
  FCM_PRIVATE_KEY: 'x',
};

describe('PRC-M326 live adapter capability', () => {
  it('reports each configured channel as live with the chosen adapter', () => {
    const caps = listProviderCapabilities(FULL);
    const byChannel = Object.fromEntries(caps.map((c) => [c.channel, c]));
    expect(byChannel.psp).toMatchObject({
      mode: 'live',
      adapter: 'RazorpayPaymentAdapter',
    });
    expect(byChannel.sms).toMatchObject({
      mode: 'live',
      adapter: 'Msg91SmsSender',
      liveReady: true,
    });
    expect(byChannel.email).toMatchObject({
      mode: 'live',
      adapter: 'SesEmailSender',
      liveReady: true,
    });
    expect(byChannel.push).toMatchObject({
      mode: 'live',
      adapter: 'FcmPushSender',
      liveReady: true,
    });
    for (const cap of caps.filter((c) => c.channel !== 'idp')) {
      expect(cap.notes).toMatch(/stubbed provider/);
    }
  });

  it('PSP is not liveReady with full Razorpay credentials while the webhook route is unmounted', () => {
    // RazorpayPaymentAdapter.charge() returns 'pending' and only the Razorpay webhook
    // can settle it; no gateway route mounts that webhook yet (PRC-M512 residual).
    const psp = listProviderCapabilities(FULL).find((c) => c.channel === 'psp')!;
    expect(psp.liveReady).toBe(false);
    expect(psp.notes).toMatch(/webhook/i);
    expect(psp.notes).toMatch(/not mounted/i);
  });
  it('one missing credential keeps that channel sandbox and not ready', () => {
    for (const [channel, names] of Object.entries(LIVE_ADAPTER_ENV)) {
      const env = { ...FULL, [names[0]!]: '' };
      const cap = listProviderCapabilities(env).find((c) => c.channel === channel)!;
      expect(cap, channel).toMatchObject({ mode: 'sandbox', liveReady: false });
    }
  });

  it('full credentials without PROVIDER_MODE=live stay sandbox', () => {
    const { PROVIDER_MODE: _mode, ...sandboxEnv } = FULL;
    const caps = listProviderCapabilities({ ...sandboxEnv, PROVIDER_MODE: 'sandbox' });
    expect(caps.filter((c) => c.channel !== 'idp').every((c) => !c.liveReady)).toBe(true);
  });
});
