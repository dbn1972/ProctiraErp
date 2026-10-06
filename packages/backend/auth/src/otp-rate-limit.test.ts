/**
 * PRC-M498 — OTP send/resend caps, cooldown, cross-resend attempt carry-over
 * and lockout. Throttled sends never reach the SMS provider.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  InMemoryOtpChallengeStore,
  OtpAuthError,
  OtpRateLimitError,
  OtpService,
  type OtpAbuseSignal,
} from './otp-service.js';
import type { SmsProvider } from './sms-provider.js';

const USER = { userId: 'u1', tenantId: 't1', phone: '+15550001111' };

function setup(overrides: Partial<ConstructorParameters<typeof OtpService>[0]> = {}) {
  const send = vi.fn(async () => undefined);
  const signals: OtpAbuseSignal[] = [];
  const otp = new OtpService({
    store: new InMemoryOtpChallengeStore(),
    sms: { name: 'test', send } as unknown as SmsProvider,
    pepper: 'p',
    exposeCodeInResponse: true,
    onAbuseSignal: (s) => signals.push(s),
    ...overrides,
  });
  return { otp, send, signals };
}

describe('PRC-M498 OTP abuse controls', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('6th resend within the window returns 429 and sends no SMS', async () => {
    const { otp, send, signals } = setup();
    let { mfaToken } = await otp.sendChallenge(USER);
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(61_000);
      ({ mfaToken } = await otp.resendChallenge(mfaToken));
    }
    expect(send).toHaveBeenCalledTimes(5);
    vi.advanceTimersByTime(61_000);
    await expect(otp.resendChallenge(mfaToken)).rejects.toBeInstanceOf(OtpRateLimitError);
    expect(send).toHaveBeenCalledTimes(5);
    expect(signals.map((s) => s.reason)).toContain('user_cap');
  });

  it('enforces a resend cooldown', async () => {
    const { otp, send } = setup();
    const { mfaToken } = await otp.sendChallenge(USER);
    await expect(otp.resendChallenge(mfaToken)).rejects.toBeInstanceOf(OtpRateLimitError);
    await expect(otp.sendChallenge(USER)).rejects.toBeInstanceOf(OtpRateLimitError);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('caps sends per phone across users', async () => {
    const { otp } = setup({ resendCooldownSeconds: 0 });
    for (let i = 0; i < 5; i++) {
      await otp.sendChallenge({ ...USER, userId: `u${i}` });
    }
    await expect(otp.sendChallenge({ ...USER, userId: 'u9' })).rejects.toBeInstanceOf(
      OtpRateLimitError,
    );
  });

  it('resend on an expired or consumed challenge fails', async () => {
    const { otp } = setup();
    const first = await otp.sendChallenge(USER);
    vi.advanceTimersByTime(301_000);
    await expect(otp.resendChallenge(first.mfaToken)).rejects.toBeInstanceOf(OtpAuthError);

    const second = await otp.sendChallenge(USER);
    await otp.verifyChallenge({ mfaToken: second.mfaToken, code: second.debugCode! });
    vi.advanceTimersByTime(61_000);
    await expect(otp.resendChallenge(second.mfaToken)).rejects.toThrow(/already been used/);
  });

  it('carries failed attempts across resends', async () => {
    const { otp } = setup({ maxAttempts: 3 });
    const { mfaToken } = await otp.sendChallenge(USER);
    for (let i = 0; i < 2; i++) {
      await expect(otp.verifyChallenge({ mfaToken, code: 'bad' })).rejects.toBeInstanceOf(
        OtpAuthError,
      );
    }
    vi.advanceTimersByTime(61_000);
    const next = await otp.resendChallenge(mfaToken);
    await expect(otp.verifyChallenge({ mfaToken: next.mfaToken, code: 'bad' })).rejects.toThrow(
      'Invalid verification code',
    );
    // Budget of 3 is exhausted across the resend: even the right code is refused.
    await expect(
      otp.verifyChallenge({ mfaToken: next.mfaToken, code: next.debugCode! }),
    ).rejects.toThrow(/Too many invalid attempts/);
  });

  it('total failed verifies across resends lock the user', async () => {
    const { otp, send, signals } = setup({ maxAttempts: 5, maxFailedAttemptsPerWindow: 4 });
    const a = await otp.sendChallenge(USER);
    for (let i = 0; i < 2; i++) {
      await otp.verifyChallenge({ mfaToken: a.mfaToken, code: 'bad' }).catch(() => undefined);
    }
    vi.advanceTimersByTime(61_000);
    const b = await otp.resendChallenge(a.mfaToken);
    for (let i = 0; i < 2; i++) {
      await otp.verifyChallenge({ mfaToken: b.mfaToken, code: 'bad' }).catch(() => undefined);
    }
    await expect(
      otp.verifyChallenge({ mfaToken: b.mfaToken, code: b.debugCode! }),
    ).rejects.toBeInstanceOf(OtpRateLimitError);
    vi.advanceTimersByTime(61_000);
    await expect(otp.sendChallenge(USER)).rejects.toBeInstanceOf(OtpRateLimitError);
    expect(send).toHaveBeenCalledTimes(2);
    expect(signals.map((s) => s.reason)).toContain('locked');
  });
});
