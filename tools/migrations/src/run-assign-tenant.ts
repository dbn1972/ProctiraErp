/**
 * Standalone runner for the tenant assignment step.
 */

import 'dotenv/config';
import { loadConfig } from './config.js';
import { assignTenant } from './assign-tenant.js';

const config = loadConfig();
const result = await assignTenant(config);

if (result.status === 'error') {
  console.error('Tenant assignment failed.');
  process.exit(1);
}

console.log(
  `Tenant assignment complete: ${result.tablesProcessed} tables, ${result.rowsProcessed} rows`,
);
