/**
 * In-memory stand-ins for the isolation gate.
 *
 * PRC-M614: the query-scoping, cache and report suites drive product code
 * (`@proctira/database`, `@proctira/cache`, `@proctira/backend-report`), so the
 * former simulators of those subsystems were removed. The search index is the
 * product `@proctira/search-index` implementation.
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 */
// ---------------------------------------------------------------------------
// Tenant-scoped search index (W3-D2 foundation — @proctira/search-index)
// ---------------------------------------------------------------------------

export type { LegacySearchDocument as SearchDocument } from '@proctira/search-index';
export { TenantScopedSearchIndex } from '@proctira/search-index';
