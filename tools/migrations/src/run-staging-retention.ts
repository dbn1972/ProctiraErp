/**
 * PRC-M557 — staging schema retention entrypoint (DR35).
 *
 *   migrate:signoff        record cutover sign-off on the staging schema
 *   migrate:purge-staging  drop the staging schema once sign-off + 30 days
 *                          has passed (run on a schedule; no opt-in flag)
 */
import 'dotenv/config';
import { Pool } from 'pg';

import { loadConfig } from './config.js';
import { enforceStagingRetention, recordCutoverSignOff } from './staging-retention.js';

const config = loadConfig();
const signOff = process.argv.includes('--sign-off');
const pool = new Pool({
  host: config.pg.host,
  port: config.pg.port,
  database: config.pg.database,
  user: config.pg.user,
  password: config.pg.password,
});

async function main(): Promise<void> {
  try {
    if (signOff) {
      const at = await recordCutoverSignOff(pool, config.stagingSchema);
      console.log(
        `Cutover sign-off for "${config.stagingSchema}" recorded at ${at.toISOString()}; it is purged 30 days later.`,
      );
      return;
    }
    const decision = await enforceStagingRetention(pool, config.stagingSchema);
    if (decision.action === 'absent') {
      console.log(`Staging schema "${config.stagingSchema}" not present; nothing to purge.`);
    } else if (decision.action === 'purge') {
      console.log(
        `Staging schema "${config.stagingSchema}" dropped (signed off ${decision.signedOffAt.toISOString()}).`,
      );
    } else if (decision.reason === 'not_signed_off') {
      console.warn(
        `Staging schema "${config.stagingSchema}" kept: no cutover sign-off recorded. Run migrate:signoff after cutover.`,
      );
    } else {
      console.log(
        `Staging schema "${config.stagingSchema}" kept until ${decision.purgeAfter.toISOString()}.`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Staging retention failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
