/**
 * Unit tests for SMS OTP hashing / send / verify.
 */
import { describe, expect, it, vi } from 'vitest';

import { createHash } from 'node:crypto';

import { InMemoryOtpChallengeStore, OtpAuthError, OtpService, hashOtpCode } from './otp-service.js';
import {
  ConsoleSmsProvider,
  maskPhone,
  redactOtpDigits,
  type SmsProvider,
} from './sms-provider.js';

describe('hashOtpCode', () => {
  it('is deterministic and not plaintext', () => {
    expect(hashOtpCode('123456', 'pepper', 'tok-1')).toBe(hashOtpCode('123456', 'pepper', 'tok-1'));
    expect(hashOtpCode('123456', 'pepper', 'tok-1')).not.toBe('123456');
    expect(hashOtpCode('123456', 'pepper', 'tok-1')).not.toBe(
      hashOtpCode('654321', 'pepper', 'tok-1'),
    );
  });

  it('same code hashes differently per challenge and per pepper (PRC-L281)', () => {
    const base = hashOtpCode('123456', 'pepper', 'tok-1');
    expect(hashOtpCode('123456', 'pepper', 'tok-2')).not.toBe(base);
    expect(hashOtpCode('123456', 'other-pepper', 'tok-1')).not.toBe(base);
    // Not the unkeyed SHA-256 of the code (reversible from a DB read).
    expect(base).not.toBe(createHash('sha256').update('123456').digest('hex'));
    expect(() => hashOtpCode('123456', '', 'tok-1')).toThrow();
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

describe('OtpService concurrency (PRC-M177)', () => {
  /** Store whose reads yield to the event loop, exposing any read-modify-write race. */
  class SlowStore extends InMemoryOtpChallengeStore {
    override async findByToken(mfaToken: string) {
      await new Promise((r) => setTimeout(r, 1));
      return super.findByToken(mfaToken);
    }
  }
  const make = (store = new SlowStore()) => ({
    store,
    service: new OtpService({
      store,
      sms: new ConsoleSmsProvider(),
      maxAttempts: 5,
      exposeCodeInResponse: true,
    }),
  });
  it('50 parallel wrong codes evaluate at most maxAttempts attempts', async () => {
    const { store, service } = make();
    const ch = await service.sendChallenge({ userId: 'u1', tenantId: 't1', phone: '+15551234567' });
    const wrong = ch.debugCode === '000000' ? '111111' : '000000';
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () =>
        service.verifyChallenge({ mfaToken: ch.mfaToken, code: wrong }),
      ),
    );
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    const row = await store.findByToken(ch.mfaToken);
    expect(row?.attemptCount).toBe(5);
    await expect(
      service.verifyChallenge({ mfaToken: ch.mfaToken, code: ch.debugCode! }),
    ).rejects.toThrow(/Too many invalid attempts/);
  });
  it('two parallel correct codes produce exactly one success', async () => {
    const { service } = make();
    const ch = await service.sendChallenge({ userId: 'u1', tenantId: 't1', phone: '+15551234567' });
    const results = await Promise.allSettled([
      service.verifyChallenge({ mfaToken: ch.mfaToken, code: ch.debugCode! }),
      service.verifyChallenge({ mfaToken: ch.mfaToken, code: ch.debugCode! }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});
describe('ConsoleSmsProvider redaction (G-731)', () => {
  it('never logs a usable OTP code or full phone number', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      await new ConsoleSmsProvider().send({
        to: '+15551234567',
        body: 'Your ProctiraERP code is 483920. It expires in 5 minutes.',
      });
      const line = String(info.mock.calls[0]?.[0] ?? '');
      expect(line).not.toContain('483920');
      expect(line).not.toContain('5551234567');
      expect(line).toContain('••••••');
      expect(line).toContain('to=+•••••••••67');
    } finally {
      info.mockRestore();
    }
  });

  it('redactOtpDigits masks 4–8 digit runs only', () => {
    expect(redactOtpDigits('code 1234 and 12345678 but not 123 or 123456789')).toBe(
      'code •••• and •••••••• but not 123 or 123456789',
    );
    expect(maskPhone('+919876543210')).toBe('+••••••••••10');
  });
});
