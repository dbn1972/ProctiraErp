/**
 * Runner script for CDC-based incremental sync.
 * Captures changes from legacy system and applies them to the new system.
 */

import 'dotenv/config';
import { loadCDCConfig } from './cdc-config.js';
import { runIncrementalSync } from './cdc-sync.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const cdcConfig = loadCDCConfig();

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           CDC Incremental Sync                               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Kafka brokers: ${cdcConfig.kafkaBrokers.join(', ')}`);
  console.log(`Topic prefix: ${cdcConfig.topicPrefix}`);
  console.log(`Conflict resolution: ${cdcConfig.conflictResolution}`);
  console.log('');

  const result = await runIncrementalSync(config, cdcConfig);

  if (result.status === 'error') {
    console.error('\n✗ Incremental sync failed.');
    process.exit(1);
  }

  console.log(`\n✓ Incremental sync complete (${result.durationMs}ms)`);
  console.log(`  Tables: ${result.tablesProcessed} | Rows synced: ${result.rowsProcessed}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
