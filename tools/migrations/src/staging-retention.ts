/**
 * PRC-M557 — retention of the legacy-migration staging schema (DR35).
 *
 * The staging schema holds raw legacy PII (national ids, dates of birth,
 * names). Owner rule DR35: legacy-migration staging copies are deleted 30 days
 * after cutover sign-off. The sign-off is recorded on the schema itself (a
 * schema comment), so it is dropped together with the data. The purge is the
 * default: `migrate:purge-staging` drops the schema once the window has passed,
 * with no opt-in flag, and keeps it (saying when it becomes due) otherwise.
 */
import { assertSafeIdentifier } from './sql-safety.js';

/** DR35: legacy-migration staging copies, 30 days after cutover sign-off. */
export const STAGING_RETENTION_DAYS = 30;
export const CUTOVER_SIGNOFF_PREFIX = 'proctira:cutover-signed-off-at=';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface StagingQueryClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export type StagingRetentionDecision =
  | { action: 'absent' }
  | { action: 'retain'; reason: 'not_signed_off' }
  | { action: 'retain'; reason: 'within_window'; signedOffAt: Date; purgeAfter: Date }
  | { action: 'purge'; signedOffAt: Date; purgeAfter: Date };

function assertStagingSchema(schema: string): void {
  assertSafeIdentifier(schema, 'MIGRATION_STAGING_SCHEMA');
  if (schema === 'public') {
    throw new Error('Refusing to treat the public schema as migration staging');
  }
}

/** Parses the sign-off timestamp out of a staging schema comment. */
export function parseCutoverSignOff(comment: string | null | undefined): Date | null {
  if (!comment?.startsWith(CUTOVER_SIGNOFF_PREFIX)) return null;
  const at = new Date(comment.slice(CUTOVER_SIGNOFF_PREFIX.length).trim());
  return Number.isNaN(at.getTime()) ? null : at;
}

/** Pure retention rule: purge only once sign-off + retentionDays has passed. */
export function decideStagingRetention(input: {
  exists: boolean;
  signedOffAt: Date | null;
  now: Date;
  retentionDays?: number;
}): StagingRetentionDecision {
  if (!input.exists) return { action: 'absent' };
  if (!input.signedOffAt) return { action: 'retain', reason: 'not_signed_off' };
  const days = input.retentionDays ?? STAGING_RETENTION_DAYS;
  const purgeAfter = new Date(input.signedOffAt.getTime() + days * DAY_MS);
  if (input.now.getTime() >= purgeAfter.getTime()) {
    return { action: 'purge', signedOffAt: input.signedOffAt, purgeAfter };
  }
  return { action: 'retain', reason: 'within_window', signedOffAt: input.signedOffAt, purgeAfter };
}

async function readStagingState(
  client: StagingQueryClient,
  schema: string,
): Promise<{ exists: boolean; signedOffAt: Date | null }> {
  const res = await client.query(
    `SELECT obj_description(oid, 'pg_namespace') AS comment FROM pg_namespace WHERE nspname = $1`,
    [schema],
  );
  const row = res.rows[0];
  if (!row) return { exists: false, signedOffAt: null };
  return { exists: true, signedOffAt: parseCutoverSignOff(row['comment'] as string | null) };
}

/** Records the cutover sign-off on the staging schema (starts the 30-day clock). */
export async function recordCutoverSignOff(
  client: StagingQueryClient,
  schema: string,
  now: Date = new Date(),
): Promise<Date> {
  assertStagingSchema(schema);
  const state = await readStagingState(client, schema);
  if (!state.exists) throw new Error(`Staging schema "${schema}" does not exist`);
  // An earlier sign-off is kept: re-running sign-off must not extend the window.
  if (state.signedOffAt) return state.signedOffAt;
  const comment = `${CUTOVER_SIGNOFF_PREFIX}${now.toISOString()}`;
  // COMMENT ON takes no bind parameters; the value is our own ISO timestamp.
  await client.query(`COMMENT ON SCHEMA "${schema}" IS '${comment}'`);
  return now;
}

/**
 * Applies the retention rule: drops the staging schema when it is due and
 * reports the decision either way.
 */
export async function enforceStagingRetention(
  client: StagingQueryClient,
  schema: string,
  now: Date = new Date(),
  retentionDays: number = STAGING_RETENTION_DAYS,
): Promise<StagingRetentionDecision> {
  assertStagingSchema(schema);
  const decision = decideStagingRetention({
    ...(await readStagingState(client, schema)),
    now,
    retentionDays,
  });
  if (decision.action === 'purge') {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
  return decision;
}
