/**
 * Standalone runner for the schema transformation step.
 */

import 'dotenv/config';
import { loadConfig } from './config.js';
import { transformSchema } from './transform-schema.js';

const config = loadConfig();
const result = await transformSchema(config);

if (result.status === 'error') {
  console.error('Schema transformation failed.');
  process.exit(1);
}

console.log(`Transform complete: ${result.tablesProcessed} tables, ${result.rowsProcessed} rows`);
