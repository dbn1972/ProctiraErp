/**
 * Standalone runner for the pgloader bulk transfer step.
 */

import 'dotenv/config';
import { loadConfig } from './config.js';
import { runPgloader } from './pgloader-config.js';

const config = loadConfig();
const result = await runPgloader(config);

if (result.status === 'error') {
  console.error('pgloader bulk transfer failed.');
  process.exit(1);
}

console.log(`pgloader complete: ${result.tablesProcessed} tables, ${result.rowsProcessed} rows`);
