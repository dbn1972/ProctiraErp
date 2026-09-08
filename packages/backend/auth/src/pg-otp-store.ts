/**
 * Postgres OTP challenge store (G-704) on `control_plane_documents`.
 *
 * Challenges were in-memory only, so a gateway restart (or a second replica)
 * invalidated every in-flight MFA login. Rows are keyed by the opaque
 * `mfaToken`, carry the tenant id for RLS and store only the SHA-256 hash.
 */
import {
  assertInMemoryFallbackAllowed,
  getSharedPgPool,
  PgDocumentCollection,
  type PgPoolWithConnect,
  type PgQueryable,
} from '@proctira/database';

import { InMemoryOtpChallengeStore, type OtpChallengeRecord, type OtpChallengeStore } from './otp-service.js';

export class PgOtpChallengeStore implements OtpChallengeStore {
  private readonly challenges: PgDocumentCollection<OtpChallengeRecord>;

  constructor(pool: PgPoolWithConnect | PgQueryable) {
    this.challenges = new PgDocumentCollection<OtpChallengeRecord>(pool, 'auth.otp_challenges');
  }

  create(record: OtpChallengeRecord): Promise<OtpChallengeRecord> {
    return this.challenges.put(record.mfaToken, { ...record }, record.tenantId);
  }

  findByToken(mfaToken: string): Promise<OtpChallengeRecord | null> {
    return this.challenges.get(mfaToken);
  }

  private async findById(id: string): Promise<OtpChallengeRecord | null> {
    return this.challenges.first({ id } as Partial<OtpChallengeRecord>);
  }

  async incrementAttempts(id: string): Promise<void> {
    const row = await this.findById(id);
    if (!row) return;
    await this.challenges.put(
      row.mfaToken,
      { ...row, attemptCount: row.attemptCount + 1 },
      row.tenantId,
    );
  }

  async consume(id: string): Promise<void> {
    const row = await this.findById(id);
    if (!row) return;
    await this.challenges.put(row.mfaToken, { ...row, consumedAt: new Date() }, row.tenantId);
  }
}

/** Postgres when DATABASE_URL is set, else in-memory (refused in production). */
export function createOtpChallengeStore(databaseUrl?: string): OtpChallengeStore {
  const pool = getSharedPgPool(databaseUrl);
  if (pool) return new PgOtpChallengeStore(pool);
  assertInMemoryFallbackAllowed('auth-otp');
  return new InMemoryOtpChallengeStore();
}
