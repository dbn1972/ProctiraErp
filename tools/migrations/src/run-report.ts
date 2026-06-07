/**
 * Runner script for migration report generation.
 * Generates a comprehensive report of the migration status.
 */

import 'dotenv/config';
import { loadConfig } from './config.js';
import { generateMigrationReport } from './migration-report.js';

async function main(): Promise<void> {
  const config = loadConfig();

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           Migration Report Generation                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const result = await generateMigrationReport(config);

  if (result.status === 'error') {
    console.error('\n✗ Report generation failed.');
    process.exit(1);
  }

  console.log(`\n✓ Report generated (${result.durationMs}ms)`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
