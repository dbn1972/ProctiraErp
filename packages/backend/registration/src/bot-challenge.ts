/**
 * PRC-M332 — mandatory, self-hosted bot control for anonymous registration
 * submits: an HMAC-signed proof-of-work challenge (no third party, no visual
 * CAPTCHA).
 *
 * 1. `GET /registrations/challenge` issues `{nonce, difficulty, expiresAt, sig}`
 *    with `sig = HMAC-SHA256(secret, nonce|difficulty|expiresAt|tenantId)`.
 * 2. The client finds `counter` so `sha256(nonce|counter)` starts with
 *    `difficulty` zero bits and sends
 *    `x-registration-challenge: v1.<nonce>.<difficulty>.<expiresAt>.<sig>.<counter>`.
 * 3. The submit handler checks the signature (tenant-bound), expiry, work and
 *    single use (a replica-shared {@link ChallengeNonceStore}).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { ChallengeNonceStore } from './bot-challenge-nonce-store.js';

/** Default work: 16 leading zero bits (~65k SHA-256 on average). */
export const DEFAULT_CHALLENGE_DIFFICULTY = 16;
export const MIN_CHALLENGE_DIFFICULTY = 8;
export const MAX_CHALLENGE_DIFFICULTY = 24;
/** Default challenge lifetime. */
export const DEFAULT_CHALLENGE_TTL_SECONDS = 300;
/** Minimum HMAC key length accepted in a deployed environment. */
export const MIN_CHALLENGE_SECRET_LENGTH = 32;

const TOKEN_VERSION = 'v1';
const NONCE_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;
const SIG_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const COUNTER_PATTERN = /^\d{1,12}$/;

export interface IssuedRegistrationChallenge {
  nonce: string;
  difficulty: number;
  /** Epoch milliseconds. */
  expiresAt: number;
  sig: string;
  algorithm: 'sha256-leading-zero-bits';
}

function signChallenge(
  secret: string,
  nonce: string,
  difficulty: number,
  expiresAt: number,
  tenantId: string,
): string {
  return createHmac('sha256', secret)
    .update(`${nonce}|${difficulty}|${expiresAt}|${tenantId}`)
    .digest('base64url');
}

/** Clamp a configured difficulty into the supported range. */
export function normaliseChallengeDifficulty(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed)) return DEFAULT_CHALLENGE_DIFFICULTY;
  return Math.min(MAX_CHALLENGE_DIFFICULTY, Math.max(MIN_CHALLENGE_DIFFICULTY, parsed));
}

/** Issue a tenant-bound challenge. */
export function issueRegistrationChallenge(input: {
  secret: string;
  tenantId: string;
  difficulty?: number;
  ttlSeconds?: number;
  now?: number;
}): IssuedRegistrationChallenge {
  const difficulty = normaliseChallengeDifficulty(input.difficulty ?? DEFAULT_CHALLENGE_DIFFICULTY);
  const expiresAt =
    (input.now ?? Date.now()) + (input.ttlSeconds ?? DEFAULT_CHALLENGE_TTL_SECONDS) * 1000;
  const nonce = randomBytes(18).toString('base64url');
  return {
    nonce,
    difficulty,
    expiresAt,
    sig: signChallenge(input.secret, nonce, difficulty, expiresAt, input.tenantId),
    algorithm: 'sha256-leading-zero-bits',
  };
}

/** Number of leading zero bits in a digest. */
export function leadingZeroBits(digest: Uint8Array): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

/** True when `sha256(nonce|counter)` meets the difficulty. */
export function proofOfWorkMeets(nonce: string, counter: string, difficulty: number): boolean {
  return leadingZeroBits(createHash('sha256').update(`${nonce}|${counter}`).digest()) >= difficulty;
}

/** Serialise a solved challenge into the `x-registration-challenge` header value. */
export function formatChallengeToken(
  challenge: Pick<IssuedRegistrationChallenge, 'nonce' | 'difficulty' | 'expiresAt' | 'sig'>,
  counter: number | string,
): string {
  return [
    TOKEN_VERSION,
    challenge.nonce,
    challenge.difficulty,
    challenge.expiresAt,
    challenge.sig,
    counter,
  ].join('.');
}

/** Brute-force a solution (server-side helper for tests and tooling). */
export function solveRegistrationChallenge(
  challenge: Pick<IssuedRegistrationChallenge, 'nonce' | 'difficulty' | 'expiresAt' | 'sig'>,
  maxIterations = 50_000_000,
): string {
  for (let counter = 0; counter < maxIterations; counter += 1) {
    if (proofOfWorkMeets(challenge.nonce, String(counter), challenge.difficulty)) {
      return formatChallengeToken(challenge, counter);
    }
  }
  throw new Error('challenge not solved within the iteration budget');
}

export type ChallengeVerificationFailure =
  'malformed' | 'bad_signature' | 'expired' | 'insufficient_work' | 'replayed';

/** Verify a submitted token; claims the nonce only when every other check passes. */
export async function verifyRegistrationChallenge(
  token: string,
  input: {
    secret: string;
    tenantId: string;
    nonceStore: ChallengeNonceStore;
    /** Server-configured minimum difficulty; a signed lower difficulty is refused. */
    minDifficulty?: number;
    now?: number;
  },
): Promise<{ ok: true } | { ok: false; reason: ChallengeVerificationFailure }> {
  const parts = token.split('.');
  if (parts.length !== 6 || parts[0] !== TOKEN_VERSION) return { ok: false, reason: 'malformed' };
  const [, nonce, difficultyRaw, expiresAtRaw, sig, counter] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const difficulty = Number(difficultyRaw);
  const expiresAt = Number(expiresAtRaw);
  if (
    !NONCE_PATTERN.test(nonce) ||
    !SIG_PATTERN.test(sig) ||
    !COUNTER_PATTERN.test(counter) ||
    !Number.isInteger(difficulty) ||
    !Number.isSafeInteger(expiresAt)
  ) {
    return { ok: false, reason: 'malformed' };
  }
  const expected = Buffer.from(
    signChallenge(input.secret, nonce, difficulty, expiresAt, input.tenantId),
  );
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'bad_signature' };
  }
  const now = input.now ?? Date.now();
  if (expiresAt <= now) return { ok: false, reason: 'expired' };
  const required = Math.max(difficulty, input.minDifficulty ?? MIN_CHALLENGE_DIFFICULTY);
  if (!proofOfWorkMeets(nonce, counter, required)) {
    return { ok: false, reason: 'insufficient_work' };
  }
  const ttlSeconds = Math.max(1, Math.ceil((expiresAt - now) / 1000));
  if (!(await input.nonceStore.claim(nonce, ttlSeconds))) return { ok: false, reason: 'replayed' };
  return { ok: true };
}
