/**
 * Runner script for schema constraint validation.
 * Validates migrated data against new schema constraints without halting.
 */

import 'dotenv/config';
import { loadConfig } from './config.js';
import { validateConstraints } from './constraint-validator.js';

async function main(): Promise<void> {
  const config = loadConfig();

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           Schema Constraint Validation                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const result = await validateConstraints(config);

  // Note: We never exit with error code for constraint violations
  // because the requirement says "report violations without halting"
  if (result.status === 'error') {
    console.error('\n✗ Validation process itself failed (not a data issue).');
    process.exit(1);
  }

  console.log(`\n✓ Constraint validation complete (${result.durationMs}ms)`);
  if (result.errors.length > 0) {
    console.log(`  ${result.errors.length} constraint violations found — see report above.`);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
