/**
 * MFA OTP challenge service.
 *
 * Challenges are persisted as SHA-256 hashes with an expiry. The opaque
 * `mfaToken` returned to the client is a random UUID used as the lookup key.
 */
import { createHash, randomInt, randomUUID } from 'node:crypto';

import type { SmsProvider } from './sms-provider.js';

export interface OtpChallengeRecord {
  id: string;
  mfaToken: string;
  userId: string;
  tenantId: string;
  phone: string;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attemptCount: number;
  createdAt: Date;
}

export interface OtpChallengeStore {
  create(record: OtpChallengeRecord): Promise<OtpChallengeRecord>;
  findByToken(mfaToken: string): Promise<OtpChallengeRecord | null>;
  incrementAttempts(id: string): Promise<void>;
  consume(id: string): Promise<void>;
}

export class InMemoryOtpChallengeStore implements OtpChallengeStore {
  private readonly byToken = new Map<string, OtpChallengeRecord>();

  async create(record: OtpChallengeRecord): Promise<OtpChallengeRecord> {
    this.byToken.set(record.mfaToken, { ...record });
    return { ...record };
  }

  async findByToken(mfaToken: string): Promise<OtpChallengeRecord | null> {
    const row = this.byToken.get(mfaToken);
    return row ? { ...row } : null;
  }

  async incrementAttempts(id: string): Promise<void> {
    for (const [token, row] of this.byToken) {
      if (row.id === id) {
        this.byToken.set(token, { ...row, attemptCount: row.attemptCount + 1 });
        return;
      }
    }
  }

  async consume(id: string): Promise<void> {
    for (const [token, row] of this.byToken) {
      if (row.id === id) {
        this.byToken.set(token, { ...row, consumedAt: new Date() });
        return;
      }
    }
  }
}

export function hashOtpCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export function generateOtpCode(digits = 6): string {
  const max = 10 ** digits;
  return String(randomInt(0, max)).padStart(digits, '0');
}

export interface SendOtpResult {
  mfaToken: string;
  expiresAt: string;
  method: 'sms';
  /** Masked phone for UI display, e.g. +91••••••3210 */
  phoneHint: string;
  /** Dev-only: present when ConsoleSmsProvider is active and MFA_EXPOSE_OTP=true */
  debugCode?: string;
}

export interface VerifyOtpResult {
  userId: string;
  tenantId: string;
}

export interface OtpServiceOptions {
  store: OtpChallengeStore;
  sms: SmsProvider;
  /** Challenge TTL in seconds (default 300). */
  ttlSeconds?: number;
  /** Max verify attempts before the challenge is locked (default 5). */
  maxAttempts?: number;
  /** When true, include the plaintext code in send responses (dev only). */
  exposeCodeInResponse?: boolean;
  /** Message template; `{code}` is replaced. */
  messageTemplate?: string;
}

export class OtpService {
  private readonly store: OtpChallengeStore;
  private readonly sms: SmsProvider;
  private readonly ttlSeconds: number;
  private readonly maxAttempts: number;
  private readonly exposeCodeInResponse: boolean;
  private readonly messageTemplate: string;

  constructor(options: OtpServiceOptions) {
    this.store = options.store;
    this.sms = options.sms;
    this.ttlSeconds = options.ttlSeconds ?? 300;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.exposeCodeInResponse = options.exposeCodeInResponse ?? false;
    this.messageTemplate =
      options.messageTemplate ??
      'Your ProctiraERP verification code is {code}. It expires in 5 minutes.';
  }

  async sendChallenge(input: {
    userId: string;
    tenantId: string;
    phone: string;
  }): Promise<SendOtpResult> {
    const phone = normalisePhone(input.phone);
    if (!phone) {
      throw new OtpValidationError('A valid phone number is required');
    }

    const code = generateOtpCode(6);
    const mfaToken = randomUUID();
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    const record: OtpChallengeRecord = {
      id: randomUUID(),
      mfaToken,
      userId: input.userId,
      tenantId: input.tenantId,
      phone,
      codeHash: hashOtpCode(code),
      expiresAt,
      consumedAt: null,
      attemptCount: 0,
      createdAt: new Date(),
    };
    await this.store.create(record);

    const body = this.messageTemplate.replace('{code}', code);
    await this.sms.send({ to: phone, body });

    const result: SendOtpResult = {
      mfaToken,
      expiresAt: expiresAt.toISOString(),
      method: 'sms',
      phoneHint: maskPhone(phone),
    };
    if (this.exposeCodeInResponse || this.sms.name === 'console') {
      if (this.exposeCodeInResponse) {
        result.debugCode = code;
      }
    }
    return result;
  }

  async verifyChallenge(input: {
    mfaToken: string;
    code: string;
  }): Promise<VerifyOtpResult> {
    const record = await this.store.findByToken(input.mfaToken);
    if (!record) {
      throw new OtpAuthError('Invalid or expired verification challenge');
    }
    if (record.consumedAt) {
      throw new OtpAuthError('Verification challenge has already been used');
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new OtpAuthError('Verification code has expired');
    }
    if (record.attemptCount >= this.maxAttempts) {
      throw new OtpAuthError('Too many invalid attempts. Request a new code.');
    }

    const expected = record.codeHash;
    const actual = hashOtpCode(String(input.code ?? '').trim());
    if (expected !== actual) {
      await this.store.incrementAttempts(record.id);
      throw new OtpAuthError('Invalid verification code');
    }

    await this.store.consume(record.id);
    return { userId: record.userId, tenantId: record.tenantId };
  }

  async resendChallenge(mfaToken: string): Promise<SendOtpResult> {
    const existing = await this.store.findByToken(mfaToken);
    if (!existing) {
      throw new OtpAuthError('Invalid or expired verification challenge');
    }
    // Mark old challenge consumed so the previous code cannot be reused.
    await this.store.consume(existing.id);
    return this.sendChallenge({
      userId: existing.userId,
      tenantId: existing.tenantId,
      phone: existing.phone,
    });
  }
}

export class OtpValidationError extends Error {
  readonly statusCode = 400;
  readonly code = 'OTP_VALIDATION_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'OtpValidationError';
  }
}

export class OtpAuthError extends Error {
  readonly statusCode = 401;
  readonly code = 'OTP_AUTH_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'OtpAuthError';
  }
}

function normalisePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[^\d+]/g, '');
  if (digits.replace(/\D/g, '').length < 8) return null;
  return digits.startsWith('+') ? digits : `+${digits}`;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  const tail = digits.slice(-4);
  const prefix = phone.startsWith('+') ? `+${digits.slice(0, Math.min(2, digits.length - 4))}` : '';
  return `${prefix}••••••${tail}`;
}
