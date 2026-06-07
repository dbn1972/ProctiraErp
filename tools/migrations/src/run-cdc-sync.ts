/**
 * Runner script for CDC-based incremental sync.
 * Captures changes from legacy system and applies them to the new system.
 */

import 'dotenv/config';
import { loadConfig } from './config.js';
import { runIncrementalSync, CDCSyncConfig } from './cdc-sync.js';

function loadCDCConfig(): CDCSyncConfig {
  return {
    kafkaBrokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    kafkaClientId: process.env.KAFKA_CLIENT_ID ?? 'proctira-cdc-producer',
    consumerGroupId: process.env.CDC_CONSUMER_GROUP ?? 'proctira-cdc-consumers',
    topicPrefix: process.env.CDC_TOPIC_PREFIX ?? 'cdc.migration',
    pollIntervalMs: parseInt(process.env.CDC_POLL_INTERVAL_MS ?? '5000', 10),
    batchSize: parseInt(process.env.CDC_BATCH_SIZE ?? '1000', 10),
    tenantId: process.env.CDC_TENANT_ID ?? 'default',
    conflictResolution: (process.env.CDC_CONFLICT_RESOLUTION ?? 'source_wins') as CDCSyncConfig['conflictResolution'],
  };
}

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
