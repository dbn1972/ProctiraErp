/**
 * PRC-M557 (DR35): the staging schema is purged by default once cutover
 * sign-off + 30 days has passed; it is kept before sign-off and inside the
 * window, and re-running sign-off never extends the window.
 */
import { describe, expect, it } from 'vitest';
import {
  CUTOVER_SIGNOFF_PREFIX,
  STAGING_RETENTION_DAYS,
  decideStagingRetention,
  enforceStagingRetention,
  parseCutoverSignOff,
  recordCutoverSignOff,
  type StagingQueryClient,
} from './staging-retention.js';

const SIGNED = new Date('2026-01-01T00:00:00.000Z');
const day = (n: number) => new Date(SIGNED.getTime() + n * 24 * 60 * 60 * 1000);

/** Minimal pg_namespace + COMMENT/DROP emulation. */
function fakeClient(initial: { exists: boolean; comment?: string | null }) {
  const state = { ...initial, comment: initial.comment ?? null };
  const sql: string[] = [];
  const client: StagingQueryClient = {
    async query(text) {
      sql.push(text);
      if (text.startsWith('SELECT obj_description')) {
        return { rows: state.exists ? [{ comment: state.comment }] : [] };
      }
      const comment = /^COMMENT ON SCHEMA "\w+" IS '(.*)'$/.exec(text);
      if (comment) {
        state.comment = comment[1] ?? null;
        return { rows: [] };
      }
      if (text.startsWith('DROP SCHEMA')) {
        state.exists = false;
        return { rows: [] };
      }
      throw new Error(`unexpected SQL: ${text}`);
    },
  };
  return { client, state, sql };
}

describe('PRC-M557 staging retention (DR35)', () => {
  it('uses the DR35 30-day window', () => {
    expect(STAGING_RETENTION_DAYS).toBe(30);
  });

  it('decides retain before sign-off, retain inside the window, purge after it', () => {
    expect(decideStagingRetention({ exists: true, signedOffAt: null, now: day(400) })).toEqual({
      action: 'retain',
      reason: 'not_signed_off',
    });
    expect(
      decideStagingRetention({ exists: true, signedOffAt: SIGNED, now: day(29) }),
    ).toMatchObject({ action: 'retain', reason: 'within_window', purgeAfter: day(30) });
    expect(
      decideStagingRetention({ exists: true, signedOffAt: SIGNED, now: day(30) }),
    ).toMatchObject({ action: 'purge', purgeAfter: day(30) });
    expect(decideStagingRetention({ exists: false, signedOffAt: null, now: day(0) })).toEqual({
      action: 'absent',
    });
  });

  it('drops the staging schema by default once due (no opt-in flag)', async () => {
    const fake = fakeClient({
      exists: true,
      comment: `${CUTOVER_SIGNOFF_PREFIX}${SIGNED.toISOString()}`,
    });
    const decision = await enforceStagingRetention(fake.client, 'migration_staging', day(31));
    expect(decision.action).toBe('purge');
    expect(fake.sql).toContain('DROP SCHEMA IF EXISTS "migration_staging" CASCADE');
    expect(fake.state.exists).toBe(false);
  });

  it('keeps an unsigned or in-window schema', async () => {
    const unsigned = fakeClient({ exists: true });
    expect(
      (await enforceStagingRetention(unsigned.client, 'migration_staging', day(90))).action,
    ).toBe('retain');
    const inWindow = fakeClient({
      exists: true,
      comment: `${CUTOVER_SIGNOFF_PREFIX}${SIGNED.toISOString()}`,
    });
    await enforceStagingRetention(inWindow.client, 'migration_staging', day(10));
    expect([...unsigned.sql, ...inWindow.sql].some((q) => q.startsWith('DROP'))).toBe(false);
  });

  it('records sign-off once; a second sign-off keeps the first date', async () => {
    const fake = fakeClient({ exists: true });
    expect(await recordCutoverSignOff(fake.client, 'migration_staging', SIGNED)).toEqual(SIGNED);
    expect(parseCutoverSignOff(fake.state.comment)).toEqual(SIGNED);
    expect(await recordCutoverSignOff(fake.client, 'migration_staging', day(20))).toEqual(SIGNED);
    expect(parseCutoverSignOff(fake.state.comment)).toEqual(SIGNED);
  });

  it('refuses unsafe or public schema names', async () => {
    const fake = fakeClient({ exists: true });
    await expect(enforceStagingRetention(fake.client, 'public', day(90))).rejects.toThrow();
    await expect(enforceStagingRetention(fake.client, 'x"; DROP', day(90))).rejects.toThrow();
    expect(fake.sql).toHaveLength(0);
  });
});
