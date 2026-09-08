/**
 * Unit tests for SMS OTP hashing / send / verify.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  InMemoryOtpChallengeStore,
  OtpAuthError,
  OtpService,
  hashOtpCode,
} from './otp-service.js';
import { ConsoleSmsProvider, type SmsProvider } from './sms-provider.js';

describe('hashOtpCode', () => {
  it('is deterministic and not plaintext', () => {
    expect(hashOtpCode('123456')).toBe(hashOtpCode('123456'));
    expect(hashOtpCode('123456')).not.toBe('123456');
    expect(hashOtpCode('123456')).not.toBe(hashOtpCode('654321'));
  });
});

describe('OtpService', () => {
  it('sends and verifies an SMS OTP challenge', async () => {
    const sent: Array<{ to: string; body: string }> = [];
    const sms: SmsProvider = {
      name: 'test',
      async send(message) {
        sent.push(message);
      },
    };
    const service = new OtpService({
      store: new InMemoryOtpChallengeStore(),
      sms,
      exposeCodeInResponse: true,
    });

    const challenge = await service.sendChallenge({
      userId: '00000000-0000-4000-8000-000000000001',
      tenantId: '00000000-0000-4000-8000-000000000099',
      phone: '+919876543210',
    });

    expect(challenge.method).toBe('sms');
    expect(challenge.mfaToken).toBeTruthy();
    expect(challenge.debugCode).toMatch(/^\d{6}$/);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('+919876543210');
    expect(sent[0]!.body).toContain(challenge.debugCode!);

    const verified = await service.verifyChallenge({
      mfaToken: challenge.mfaToken,
      code: challenge.debugCode!,
    });
    expect(verified.userId).toBe('00000000-0000-4000-8000-000000000001');

    await expect(
      service.verifyChallenge({
        mfaToken: challenge.mfaToken,
        code: challenge.debugCode!,
      }),
    ).rejects.toBeInstanceOf(OtpAuthError);
  });

  it('rejects invalid codes and locks after max attempts', async () => {
    const service = new OtpService({
      store: new InMemoryOtpChallengeStore(),
      sms: new ConsoleSmsProvider(),
      maxAttempts: 2,
      exposeCodeInResponse: true,
    });
    const challenge = await service.sendChallenge({
      userId: 'u1',
      tenantId: 't1',
      phone: '+15551234567',
    });

    await expect(
      service.verifyChallenge({ mfaToken: challenge.mfaToken, code: '000000' }),
    ).rejects.toBeInstanceOf(OtpAuthError);
    await expect(
      service.verifyChallenge({ mfaToken: challenge.mfaToken, code: '000001' }),
    ).rejects.toBeInstanceOf(OtpAuthError);
    await expect(
      service.verifyChallenge({
        mfaToken: challenge.mfaToken,
        code: challenge.debugCode!,
      }),
    ).rejects.toBeInstanceOf(OtpAuthError);
  });

  it('resend rotates the challenge token', async () => {
    const sms = { name: 'test', send: vi.fn(async () => undefined) };
    const service = new OtpService({
      store: new InMemoryOtpChallengeStore(),
      sms,
      exposeCodeInResponse: true,
    });
    const first = await service.sendChallenge({
      userId: 'u1',
      tenantId: 't1',
      phone: '+15551234567',
    });
    const second = await service.resendChallenge(first.mfaToken);
    expect(second.mfaToken).not.toBe(first.mfaToken);
    await expect(
      service.verifyChallenge({ mfaToken: first.mfaToken, code: first.debugCode! }),
    ).rejects.toBeInstanceOf(OtpAuthError);
    const verified = await service.verifyChallenge({
      mfaToken: second.mfaToken,
      code: second.debugCode!,
    });
    expect(verified.userId).toBe('u1');
  });
});
