/**
 * MFA OTP challenge service.
 *
 * Challenges are persisted as HMAC-SHA256(pepper, mfaToken:code) with an
 * expiry (PRC-L281). A plain hash of a 6-digit code is reversible by brute
 * force from a DB read; the server-side pepper is not stored with the row and
 * binding to the mfaToken makes identical codes hash differently per challenge.
 * The opaque `mfaToken` returned to the client is a random UUID lookup key.
 */
import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

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

export type OtpAttemptOutcome =
  | { status: 'verified'; record: OtpChallengeRecord }
  | { status: 'missing' | 'consumed' | 'expired' | 'locked' | 'mismatch' };

export interface OtpChallengeStore {
  create(record: OtpChallengeRecord): Promise<OtpChallengeRecord>;
  findByToken(mfaToken: string): Promise<OtpChallengeRecord | null>;
  incrementAttempts(id: string): Promise<void>;
  consume(id: string): Promise<void>;
  /**
   * PRC-M498: challenges for a user (within a tenant) or a phone created at or
   * after `since`. Backs the send/resend caps and cross-resend lockout.
   */
  listRecent(filter: {
    tenantId: string;
    userId?: string;
    phone?: string;
    since: Date;
  }): Promise<OtpChallengeRecord[]>;
  /**
   * PRC-M177: evaluate one verification attempt atomically. Implementations
   * must perform the expiry / consumed / attempt-cap checks, the attempt
   * increment on mismatch and the single-use consume as one indivisible step
   * (row lock or conditional UPDATE) so parallel requests cannot exceed the
   * attempt cap or both consume the same challenge.
   */
  verifyAttempt(
    mfaToken: string,
    matches: (record: OtpChallengeRecord) => boolean,
    maxAttempts: number,
    now: Date,
  ): Promise<OtpAttemptOutcome>;
}

/** Pure decision used by every store inside its atomic section. */
export function decideOtpAttempt(
  record: OtpChallengeRecord | null,
  matches: (record: OtpChallengeRecord) => boolean,
  maxAttempts: number,
  now: Date,
): { outcome: OtpAttemptOutcome; next: OtpChallengeRecord | null } {
  if (!record) return { outcome: { status: 'missing' }, next: null };
  if (record.consumedAt) return { outcome: { status: 'consumed' }, next: null };
  if (new Date(record.expiresAt).getTime() <= now.getTime()) {
    return { outcome: { status: 'expired' }, next: null };
  }
  if (record.attemptCount >= maxAttempts) return { outcome: { status: 'locked' }, next: null };
  if (!matches(record)) {
    return {
      outcome: { status: 'mismatch' },
      next: { ...record, attemptCount: record.attemptCount + 1 },
    };
  }
  const consumed = { ...record, attemptCount: record.attemptCount + 1, consumedAt: now };
  return { outcome: { status: 'verified', record: consumed }, next: consumed };
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

  async listRecent(filter: {
    tenantId: string;
    userId?: string;
    phone?: string;
    since: Date;
  }): Promise<OtpChallengeRecord[]> {
    return [...this.byToken.values()]
      .filter(
        (row) =>
          row.tenantId === filter.tenantId &&
          (filter.userId === undefined || row.userId === filter.userId) &&
          (filter.phone === undefined || row.phone === filter.phone) &&
          new Date(row.createdAt).getTime() >= filter.since.getTime(),
      )
      .map((row) => ({ ...row }));
  }

  async consume(id: string): Promise<void> {
    for (const [token, row] of this.byToken) {
      if (row.id === id) {
        this.byToken.set(token, { ...row, consumedAt: new Date() });
        return;
      }
    }
  }
  async verifyAttempt(
    mfaToken: string,
    matches: (record: OtpChallengeRecord) => boolean,
    maxAttempts: number,
    now: Date,
  ): Promise<OtpAttemptOutcome> {
    // Read, decide and write with no await in between: atomic on the event loop.
    const row = this.byToken.get(mfaToken) ?? null;
    const { outcome, next } = decideOtpAttempt(row ? { ...row } : null, matches, maxAttempts, now);
    if (next) this.byToken.set(mfaToken, { ...next });
    return outcome;
  }
}

export function hashOtpCode(code: string, pepper: string, mfaToken: string): string {
  if (!pepper) throw new Error('OTP pepper is required');
  return createHmac('sha256', pepper).update(`${mfaToken}:${code}`).digest('hex');
}

function hashesEqual(expectedHex: string, actualHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(actualHex, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
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
  /**
   * Server-side HMAC key for OTP hashes (PRC-L281). Must be identical across
   * replicas. When omitted a random per-process pepper is used, which is only
   * safe for single-instance/dev deployments.
   */
  pepper?: string;
  /** PRC-M498: minimum seconds between sends/resends for a user (default 60). */
  resendCooldownSeconds?: number;
  /** PRC-M498: max challenges per user and per phone in the window (default 5). */
  maxSendsPerWindow?: number;
  /** PRC-M498: rolling window for send caps and lockout (default 3600). */
  sendWindowSeconds?: number;
  /** PRC-M498: total failed verifies across resends in the window that lock the user (default 10). */
  maxFailedAttemptsPerWindow?: number;
  /** PRC-M498: alert hook for SMS volume / lockouts (wire to metrics/alerting). */
  onAbuseSignal?: (signal: OtpAbuseSignal) => void;
}

/** PRC-M498: emitted when a send/verify is throttled or a user is locked. */
export interface OtpAbuseSignal {
  reason: 'cooldown' | 'user_cap' | 'phone_cap' | 'locked';
  tenantId: string;
  userId: string;
}

export class OtpService {
  private readonly store: OtpChallengeStore;
  private readonly sms: SmsProvider;
  private readonly ttlSeconds: number;
  private readonly maxAttempts: number;
  private readonly exposeCodeInResponse: boolean;
  private readonly messageTemplate: string;
  private readonly pepper: string;
  private readonly resendCooldownMs: number;
  private readonly maxSendsPerWindow: number;
  private readonly windowMs: number;
  private readonly maxFailedPerWindow: number;
  private readonly onAbuseSignal?: (signal: OtpAbuseSignal) => void;

  constructor(options: OtpServiceOptions) {
    this.resendCooldownMs = (options.resendCooldownSeconds ?? 60) * 1000;
    this.maxSendsPerWindow = options.maxSendsPerWindow ?? 5;
    this.windowMs = (options.sendWindowSeconds ?? 3600) * 1000;
    this.maxFailedPerWindow = options.maxFailedAttemptsPerWindow ?? 10;
    this.onAbuseSignal = options.onAbuseSignal;
    this.pepper = options.pepper || randomBytes(32).toString('hex');
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

    await this.assertSendAllowed(input.userId, input.tenantId, phone);
    return this.issue({ ...input, phone }, 0);
  }

  /**
   * PRC-M498: per-user cooldown, per-user and per-phone caps in the rolling
   * window, and a hard lock once total failed verifies across resends reach
   * the limit. Throttled sends never reach the SMS provider.
   */
  private async assertSendAllowed(userId: string, tenantId: string, phone: string): Promise<void> {
    const since = new Date(Date.now() - this.windowMs);
    const byUser = await this.store.listRecent({ tenantId, userId, since });
    if (this.failedAttempts(byUser) >= this.maxFailedPerWindow) {
      this.signal('locked', tenantId, userId);
      throw new OtpRateLimitError('Too many failed verification attempts. Try again later.');
    }
    const newest = Math.max(0, ...byUser.map((r) => new Date(r.createdAt).getTime()));
    if (newest && Date.now() - newest < this.resendCooldownMs) {
      this.signal('cooldown', tenantId, userId);
      throw new OtpRateLimitError('Please wait before requesting another code.');
    }
    if (byUser.length >= this.maxSendsPerWindow) {
      this.signal('user_cap', tenantId, userId);
      throw new OtpRateLimitError('Too many verification codes requested. Try again later.');
    }
    const byPhone = await this.store.listRecent({ tenantId, phone, since });
    if (byPhone.length >= this.maxSendsPerWindow) {
      this.signal('phone_cap', tenantId, userId);
      throw new OtpRateLimitError('Too many verification codes requested. Try again later.');
    }
  }

  private failedAttempts(rows: OtpChallengeRecord[]): number {
    return rows.reduce((sum, r) => sum + (r.consumedAt ? 0 : r.attemptCount), 0);
  }

  private signal(reason: OtpAbuseSignal['reason'], tenantId: string, userId: string): void {
    try {
      this.onAbuseSignal?.({ reason, tenantId, userId });
    } catch {
      // Alerting must never change the throttling decision.
    }
  }

  private async issue(
    input: { userId: string; tenantId: string; phone: string },
    carriedAttempts: number,
  ): Promise<SendOtpResult> {
    const phone = input.phone;
    const code = generateOtpCode(6);
    const mfaToken = randomUUID();
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    const record: OtpChallengeRecord = {
      id: randomUUID(),
      mfaToken,
      userId: input.userId,
      tenantId: input.tenantId,
      phone,
      codeHash: hashOtpCode(code, this.pepper, mfaToken),
      expiresAt,
      consumedAt: null,
      // PRC-M498: failed attempts carry across resends so resending never
      // resets the guess budget.
      attemptCount: carriedAttempts,
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

  async verifyChallenge(input: { mfaToken: string; code: string }): Promise<VerifyOtpResult> {
    const code = String(input.code ?? '').trim();
    const mfaToken = String(input.mfaToken ?? '');
    // PRC-M498: cross-resend lockout — failed attempts across every challenge
    // for this user inside the window block further guesses.
    const existing = await this.store.findByToken(mfaToken);
    if (
      existing &&
      !existing.consumedAt &&
      new Date(existing.expiresAt).getTime() > Date.now() &&
      existing.attemptCount < this.maxAttempts
    ) {
      const recent = await this.store.listRecent({
        tenantId: existing.tenantId,
        userId: existing.userId,
        since: new Date(Date.now() - this.windowMs),
      });
      if (this.failedAttempts(recent) >= this.maxFailedPerWindow) {
        this.signal('locked', existing.tenantId, existing.userId);
        throw new OtpRateLimitError('Too many failed verification attempts. Try again later.');
      }
    }
    const outcome = await this.store.verifyAttempt(
      mfaToken,
      (record) => hashesEqual(record.codeHash, hashOtpCode(code, this.pepper, record.mfaToken)),
      this.maxAttempts,
      new Date(),
    );
    switch (outcome.status) {
      case 'verified':
        return { userId: outcome.record.userId, tenantId: outcome.record.tenantId };
      case 'missing':
        throw new OtpAuthError('Invalid or expired verification challenge');
      case 'consumed':
        throw new OtpAuthError('Verification challenge has already been used');
      case 'expired':
        throw new OtpAuthError('Verification code has expired');
      case 'locked':
        throw new OtpAuthError('Too many invalid attempts. Request a new code.');
      default:
        throw new OtpAuthError('Invalid verification code');
    }
  }
  async resendChallenge(mfaToken: string): Promise<SendOtpResult> {
    const existing = await this.store.findByToken(mfaToken);
    if (!existing) {
      throw new OtpAuthError('Invalid or expired verification challenge');
    }
    // PRC-M498: only a live challenge can be resent.
    if (existing.consumedAt) {
      throw new OtpAuthError('Verification challenge has already been used');
    }
    if (new Date(existing.expiresAt).getTime() <= Date.now()) {
      throw new OtpAuthError('Verification code has expired');
    }
    if (existing.attemptCount >= this.maxAttempts) {
      throw new OtpAuthError('Too many invalid attempts. Sign in again.');
    }
    await this.assertSendAllowed(existing.userId, existing.tenantId, existing.phone);
    // Mark old challenge consumed so the previous code cannot be reused.
    await this.store.consume(existing.id);
    return this.issue(
      { userId: existing.userId, tenantId: existing.tenantId, phone: existing.phone },
      existing.attemptCount,
    );
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

/** PRC-M498: send/verify throttled (cooldown, caps, lockout). */
export class OtpRateLimitError extends Error {
  readonly statusCode = 429;
  readonly code = 'OTP_RATE_LIMITED';
  constructor(message: string) {
    super(message);
    this.name = 'OtpRateLimitError';
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
