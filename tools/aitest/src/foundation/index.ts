/**
 * @proctira/aitest foundation: shared harness pieces for every AI test track.
 * See tools/aitest/README.md for usage and safety rules.
 */
export * from './ports.js';
export * from './guard.js';
export * from './exec.js';
export * from './repo.js';

export * from './stack/types.js';
export {
  upStack,
  downStack,
  stackStatus,
  stopService,
  startService,
  composeExec,
  gatewayCount,
  datastoresFor,
  servicesFor,
  portsUsed,
  type DownOptions,
} from './stack/stack.js';
export {
  loadStackContext,
  contextFromState,
  loadState,
  saveState,
  stackDbUrls,
  stackSecrets,
  redisUrl,
  projectDirFor,
  stateFileFor,
  type StackContext,
} from './stack/state.js';
export type { StackSecrets } from './stack/secrets.js';
export { assertAitestProject, buildComposeArgs, expandPlaceholders } from './stack/compose.js';
export { serviceEnv, serviceUrl, SERVICE_DEFS, keycloakIssuer } from './stack/services.js';
export { migrateStack, waitForPostgres } from './stack/migrate.js';

export * from './seed/tenants.js';
export { applySyntheticSeed, seedRowCounts, seedSteps } from './seed/seed.js';
export {
  buildFixtureManifest,
  readFixtureManifest,
  writeFixtureManifest,
  fixtureId,
  type FixtureManifest,
} from './seed/fixtures.js';
export { PARAM_TABLE_HINTS, candidateTables, resolveParam } from './seed/param-map.js';

export * from './auth/roles.js';
export * from './auth/tokens.js';
export {
  ensureKeycloakUsers,
  keycloakPasswordGrant,
  keycloakJwksUrl,
  keycloakUsernames,
} from './auth/keycloak.js';

export * from './http/client.js';
export * from './http/inventory.js';
export * from './http/web-routes.js';

export { withPg, asTenant, listTenantTables, listTenantTablesWithId, ident } from './db/pg.js';
export * from './db/snapshot.js';

export * from './report/findings.js';
export * from './report/results.js';
export * from './report/pending.js';

export * from './suite/spec.js';
export * from './suite/discover.js';
export { runSuite, suiteCommand, suiteEnv, type RunSuiteOptions } from './suite/runner.js';
