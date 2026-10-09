/**
 * Database test utilities for isolation and seeding.
 */

export { TestDatabase, assertTestDatabase } from './test-db.js';
export type { DatabaseClient, TestDatabaseOptions } from './test-db.js';
export { withTestTransaction, createTransactionScope } from './transaction.js';
export { seedTestData } from './seed.js';
export type { SeedResult, SeedOptions } from './seed.js';
// PRC-L497: in-memory multi-board fixture (never persists to a database).
export {
  seedMultiBoardSchools,
  assertMultiBoardSeedInvariants,
  DEFAULT_MULTI_BOARD_PROFILE,
} from './multi-board-seed.js';
export type {
  BoardSchoolSeedSpec,
  MultiBoardSeedOptions,
  MultiBoardSeedResult,
  SchoolSeedBundle,
} from './multi-board-seed.js';
