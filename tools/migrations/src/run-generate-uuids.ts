/**
 * Standalone runner for the UUID generation step.
 */

import 'dotenv/config';
import { loadConfig } from './config.js';
import { generateUuids } from './generate-uuids.js';

const config = loadConfig();
const result = await generateUuids(config);

if (result.status === 'error') {
  console.error('UUID generation failed.');
  process.exit(1);
}

console.log(`UUID generation complete: ${result.tablesProcessed} tables, ${result.rowsProcessed} rows`);
