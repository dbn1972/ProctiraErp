/**
 * Platform-scoped persistence operations for the tenant-id signature lint
 * (PRC-M408 follow-up, PR #579).
 *
 * Some service methods work on records that are not owned by any tenant
 * (billing plan catalogue, developer accounts, the plugin registry, a
 * cross-tenant retention sweep). Requiring a `tenantId` parameter on those
 * methods is a false positive, not debt.
 *
 * This is not a name or glob exemption. Each entry names one service class
 * and the exact repository operations (`this.<receiver>.<op>(…)`) that act on
 * platform-scoped records. A public method without a tenant parameter is
 * exempt only when, after removing
 *   - calls to the listed platform-scoped operations, and
 *   - receiver calls that pass an explicit `tenantId` argument
 *     (per-tenant fan-out, e.g. a sweep that loops over tenants),
 * nothing persistence-like is left in its body. Any other repository call
 * (e.g. a subscription or webhook-delivery lookup) still fails the lint.
 *
 * The check reports an error when an entry no longer matches: the class is
 * gone, or a listed operation is not called anywhere in it. Stale entries
 * cannot silently widen the exemption.
 *
 * Paths are relative to packages/backend.
 *
 * @typedef {{
 *   file: string,
 *   className: string,
 *   receiver: string,
 *   operations: string[],
 *   reason: string,
 * }} PlatformScopeEntry
 */

/** @type {ReadonlyArray<PlatformScopeEntry>} */
export const PLATFORM_SCOPED_OPERATIONS = Object.freeze([
  {
    file: 'billing/src/billing-service.ts',
    className: 'BillingService',
    receiver: 'repository',
    operations: ['findPlanByName', 'createPlan', 'findPlanById', 'listPlans', 'updatePlan'],
    reason:
      'Billing plans are the platform price catalogue shared by every tenant: PlanEntity has no ' +
      'tenantId and PgBillingRepository stores billing.plans with tenant_id NULL ' +
      '(pg-billing-repository.ts header). Subscriptions/entitlements/usage are tenant-scoped and ' +
      'are not listed here.',
  },
  {
    file: 'developer-portal/src/developer-portal-service.ts',
    className: 'DeveloperPortalService',
    receiver: 'repository',
    operations: [
      // Developer accounts: developer_portal_accounts has no tenant_id and is
      // platform-admin-only under RLS (db/sql/089); pg store uses withPlatformScope.
      'getAccountByEmail',
      'createAccount',
      'getAccountById',
      'updateAccount',
      // Sandboxes belong to a developer account. SandboxEntity.tenantId is the
      // sandbox's own freshly minted tenant, not the caller's tenant.
      'listSandboxes',
      'createSandbox',
      'getSandboxById',
      'updateSandboxStatus',
      // Plugin submissions, marketplace listings and ratings are global
      // marketplace records keyed by developer account / plugin name; none of
      // the entities carries a tenantId. Review/publish are platform-staff only (PRC-H048).
      'getListingByName',
      'createSubmission',
      'getSubmissionById',
      'listSubmissions',
      'updateSubmissionStatus',
      'createListing',
      'deleteListing',
      'searchListings',
      'getRatingByAccountAndPlugin',
      'updateRating',
      'createRating',
      'getAverageRating',
      'updateListingStats',
      // Developer documentation pages are platform content (DocPageEntity has
      // no tenantId; writes are platform-staff only, PRC-H048).
      'getDocPageBySlug',
      'createDocPage',
      'listDocPages',
      'updateDocPage',
      'deleteDocPage',
    ],
    reason:
      'Developer accounts, sandboxes, plugin submissions, marketplace listings/ratings and ' +
      'developer docs are platform-level records with no tenant owner. API keys, webhooks, ' +
      'webhook deliveries and plugin analytics are NOT listed: they stay subject to the lint.',
  },
  {
    file: 'plugin/src/plugin-service.ts',
    className: 'PluginService',
    receiver: 'repository',
    operations: [
      'findPluginByName',
      'createPlugin',
      'createManifest',
      'findPluginById',
      'listPlugins',
    ],
    reason:
      'The plugin registry (plugins + manifests) is a platform catalogue: PluginEntity has no ' +
      'tenantId. Per-tenant installs and permissions are tenant-scoped and are not listed.',
  },
  {
    file: 'audit/src/audit-service.ts',
    className: 'AuditService',
    receiver: 'repository',
    operations: ['listTenantsWithArchivalEnabled'],
    reason:
      'G-913 retention sweep is a platform job: it enumerates tenants with archival enabled and ' +
      'then archives per tenant, passing each tenantId explicitly to archiveExpiredEntries().',
  },
]);
