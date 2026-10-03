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
  reviveDates,
  withPlatformScope,
  type PgPoolWithConnect,
  type PgQueryable,
} from '@proctira/database';

import {
  decideOtpAttempt,
  InMemoryOtpChallengeStore,
  type OtpAttemptOutcome,
  type OtpChallengeRecord,
  type OtpChallengeStore,
} from './otp-service.js';

const COLLECTION = 'auth.otp_challenges';

export class PgOtpChallengeStore implements OtpChallengeStore {
  private readonly challenges: PgDocumentCollection<OtpChallengeRecord>;

  constructor(private readonly pool: PgPoolWithConnect | PgQueryable) {
    this.challenges = new PgDocumentCollection<OtpChallengeRecord>(pool, COLLECTION);
  }

  create(record: OtpChallengeRecord): Promise<OtpChallengeRecord> {
    return this.challenges.put(record.mfaToken, { ...record }, record.tenantId);
  }

  /**
   * Deliberately unscoped, and it cannot be otherwise.
   *
   * `mfaToken` is the bearer secret for an in-flight MFA login: the caller holds
   * the token and nothing else, and the tenant id is read *from* the record that
   * is found. Requiring a tenant predicate would mean already knowing the answer.
   * Safety rests on the token being opaque and single-use, not on RLS.
   *
   * Recorded rather than fixed so it is not mistaken for an oversight when the
   * scope parameter becomes mandatory.
   */
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

  /**
   * PRC-M177: `SELECT ... FOR UPDATE` inside one transaction serialises every
   * verify of the same challenge, so the attempt cap and single-use consume
   * cannot be raced by parallel requests (each waits for the previous commit).
   */
  async verifyAttempt(
    mfaToken: string,
    matches: (record: OtpChallengeRecord) => boolean,
    maxAttempts: number,
    now: Date,
  ): Promise<OtpAttemptOutcome> {
    return withPlatformScope(this.pool, async (client) => {
      const res = await client.query(
        `SELECT data FROM control_plane_documents
          WHERE collection = $1 AND id = $2
          FOR UPDATE`,
        [COLLECTION, mfaToken],
      );
      const raw = (res.rows[0] as { data?: OtpChallengeRecord } | undefined)?.data;
      const record = raw ? reviveDates(raw) : null;
      const { outcome, next } = decideOtpAttempt(record, matches, maxAttempts, now);
      if (next) {
        await client.query(
          `UPDATE control_plane_documents SET data = $3::jsonb, updated_at = now()
            WHERE collection = $1 AND id = $2`,
          [COLLECTION, mfaToken, JSON.stringify(next)],
        );
      }
      return outcome;
    });
  }
}

/** Postgres when DATABASE_URL is set, else in-memory (refused in production). */
export function createOtpChallengeStore(databaseUrl?: string): OtpChallengeStore {
  const pool = getSharedPgPool(databaseUrl);
  if (pool) return new PgOtpChallengeStore(pool);
  assertInMemoryFallbackAllowed('auth-otp');
  return new InMemoryOtpChallengeStore();
}
