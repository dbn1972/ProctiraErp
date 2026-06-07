/**
 * Standalone runner for the post-migration validation step.
 */

import 'dotenv/config';
import { loadConfig } from './config.js';
import { validateMigration } from './validate-migration.js';

const config = loadConfig();
const result = await validateMigration(config);

if (result.status === 'error') {
  console.error('Validation found errors. Review the report above.');
  process.exit(1);
}

console.log(`Validation complete: ${result.tablesProcessed} tables checked`);
