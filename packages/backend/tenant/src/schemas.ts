/**
 * Typebox schemas for Tenant Lifecycle Service request/response validation.
 *
 * Defines schemas for:
 * - Tenant CRUD (create, update, get, list)
 * - Tenant lifecycle transitions (suspend, reactivate, decommission)
 * - Tenant configuration management (branding, locale, timezone, features)
 * - Tenant usage dashboard (storage, users, API calls)
 *
 * Tables: tenant_tenants, tenant_settings, tenant_domains
 * Charter: Section 6 (Tenant Model)
 */
import { Type, type Static } from '@sinclair/typebox';

// ─── Tenant Status ───────────────────────────────────────────────────────────

/**
 * Tenant lifecycle status values.
 */
export const TenantStatusEnum = Type.Union([
  Type.Literal('provisioning'),
  Type.Literal('active'),
  Type.Literal('suspended'),
  Type.Literal('decommissioned'),
]);

export type TenantStatus = Static<typeof TenantStatusEnum>;

// ─── Tenant Configuration Schemas ────────────────────────────────────────────

/**
 * Branding configuration for a tenant.
 */
export const BrandingConfigSchema = Type.Object({
  logoUrl: Type.Optional(Type.String({ maxLength: 2048, description: 'URL to tenant logo' })),
  faviconUrl: Type.Optional(Type.String({ maxLength: 2048, description: 'URL to tenant favicon' })),
  primaryColor: Type.Optional(
    Type.String({ pattern: '^#[0-9a-fA-F]{6}$', description: 'Primary brand color (hex)' }),
  ),
  secondaryColor: Type.Optional(
    Type.String({ pattern: '^#[0-9a-fA-F]{6}$', description: 'Secondary brand color (hex)' }),
  ),
  organizationName: Type.Optional(
    Type.String({ maxLength: 255, description: 'Display name for the organization' }),
  ),
});

export type BrandingConfig = Static<typeof BrandingConfigSchema>;

/**
 * Locale and regional settings for a tenant.
 */
export const LocaleConfigSchema = Type.Object({
  defaultLocale: Type.String({
    minLength: 2,
    maxLength: 10,
    description: 'Default locale (e.g., "en", "ar", "fr")',
  }),
  supportedLocales: Type.Array(Type.String({ minLength: 2, maxLength: 10 }), {
    minItems: 1,
    description: 'Supported locales',
  }),
  timezone: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Default timezone (IANA format, e.g., "Asia/Kolkata")',
  }),
  dateFormat: Type.Optional(
    Type.String({ maxLength: 50, description: 'Date format pattern (e.g., "DD/MM/YYYY")' }),
  ),
  numberFormat: Type.Optional(Type.String({ maxLength: 50, description: 'Number format locale' })),
});

export type LocaleConfig = Static<typeof LocaleConfigSchema>;

/**
 * Feature flags for a tenant.
 */
export const FeatureConfigSchema = Type.Object({
  modules: Type.Record(Type.String(), Type.Boolean(), {
    description: 'Module enable/disable flags',
  }),
  customFields: Type.Optional(
    Type.Boolean({ default: true, description: 'Whether custom fields are enabled' }),
  ),
  bulkImport: Type.Optional(
    Type.Boolean({ default: true, description: 'Whether bulk import is enabled' }),
  ),
  apiAccess: Type.Optional(
    Type.Boolean({ default: true, description: 'Whether API access is enabled' }),
  ),
  webhooks: Type.Optional(
    Type.Boolean({ default: false, description: 'Whether webhooks are enabled' }),
  ),
});

export type FeatureConfig = Static<typeof FeatureConfigSchema>;

/**
 * Security settings for a tenant.
 */
export const SecurityConfigSchema = Type.Object({
  mfaRequired: Type.Optional(
    Type.Boolean({ default: false, description: 'Whether MFA is required for all users' }),
  ),
  sessionTimeoutMinutes: Type.Optional(
    Type.Number({
      minimum: 5,
      maximum: 1440,
      default: 480,
      description: 'Session timeout in minutes',
    }),
  ),
  passwordMinLength: Type.Optional(
    Type.Number({ minimum: 8, maximum: 128, default: 12, description: 'Minimum password length' }),
  ),
  passwordRequireSpecialChar: Type.Optional(
    Type.Boolean({ default: true, description: 'Require special characters in passwords' }),
  ),
  ipWhitelist: Type.Optional(
    Type.Array(Type.String(), { description: 'Allowed IP addresses/CIDRs' }),
  ),
});

export type SecurityConfig = Static<typeof SecurityConfigSchema>;

/**
 * Theme tokens stored on `tenant_settings.theme` (per Task 58.2 / Design §N).
 *
 * Tokens are a free-form JSON object so the same schema applies regardless of
 * the front-end token shape (CSS custom properties, design-token-format, …).
 * Validation of individual token values (color contrast, asset dimensions)
 * lives at the publish-time guard layer (Task 58.4), not on this schema.
 */
export const ThemeTokensSchema = Type.Record(Type.String(), Type.Unknown(), {
  description: 'Tenant theme tokens (free-form JSON, validated at publish time)',
});

export type ThemeTokens = Static<typeof ThemeTokensSchema>;

/**
 * Combined tenant configuration.
 */
export const TenantConfigSchema = Type.Object({
  branding: Type.Optional(BrandingConfigSchema),
  locale: Type.Optional(LocaleConfigSchema),
  features: Type.Optional(FeatureConfigSchema),
  security: Type.Optional(SecurityConfigSchema),
  /**
   * Currently published theme tokens — mirrors the latest
   * `tenant_theme_versions` row for fast boot-time reads (Task 58.1).
   */
  theme: Type.Optional(ThemeTokensSchema),
});

export type TenantConfig = Static<typeof TenantConfigSchema>;

// ─── Tenant CRUD Schemas ─────────────────────────────────────────────────────

/**
 * Schema for creating a new tenant.
 */
export const CreateTenantSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Tenant organization name' }),
  slug: Type.String({
    minLength: 2,
    maxLength: 63,
    pattern: '^[a-z][a-z0-9-]*[a-z0-9]$',
    description: 'URL-safe slug for subdomain routing (lowercase, alphanumeric, hyphens)',
  }),
  plan: Type.Optional(Type.String({ maxLength: 100, description: 'Plan identifier' })),
  region: Type.Optional(
    Type.String({
      maxLength: 50,
      description: 'Deployment region (e.g., "us-east-1", "eu-west-1")',
    }),
  ),
  config: Type.Optional(TenantConfigSchema),
  admin: Type.Object(
    {
      firstName: Type.String({ minLength: 1, maxLength: 100, description: 'Admin first name' }),
      lastName: Type.String({ minLength: 1, maxLength: 100, description: 'Admin last name' }),
      email: Type.String({
        pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
        maxLength: 254,
        description: 'Admin email address',
      }),
      password: Type.String({ minLength: 8, maxLength: 128, description: 'Admin password' }),
    },
    { description: 'Initial admin user details' },
  ),
});

export type CreateTenantInput = Static<typeof CreateTenantSchema>;

/**
 * Schema for updating an existing tenant.
 */
export const UpdateTenantSchema = Type.Object({
  name: Type.Optional(
    Type.String({ minLength: 1, maxLength: 255, description: 'Tenant organization name' }),
  ),
  plan: Type.Optional(Type.String({ maxLength: 100, description: 'Plan identifier' })),
  region: Type.Optional(Type.String({ maxLength: 50, description: 'Deployment region' })),
  config: Type.Optional(TenantConfigSchema),
});

export type UpdateTenantInput = Static<typeof UpdateTenantSchema>;

/**
 * Schema for tenant ID path parameter.
 */
export const TenantParamsSchema = Type.Object({
  id: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Tenant UUID',
  }),
});

export type TenantParams = Static<typeof TenantParamsSchema>;

/**
 * Schema for tenant list query parameters.
 */
export const TenantListQuerySchema = Type.Object({
  page: Type.Optional(
    Type.Number({ minimum: 1, default: 1, description: 'Page number (1-based)' }),
  ),
  pageSize: Type.Optional(
    Type.Number({ minimum: 1, maximum: 100, default: 20, description: 'Items per page' }),
  ),
  status: Type.Optional(TenantStatusEnum),
  search: Type.Optional(Type.String({ description: 'Search by name or slug' })),
  region: Type.Optional(Type.String({ description: 'Filter by region' })),
  sortBy: Type.Optional(
    Type.String({
      enum: ['name', 'slug', 'createdAt', 'status'],
      default: 'createdAt',
      description: 'Sort field',
    }),
  ),
  sortOrder: Type.Optional(
    Type.String({ enum: ['asc', 'desc'], default: 'desc', description: 'Sort direction' }),
  ),
});

export type TenantListQuery = Static<typeof TenantListQuerySchema>;

// ─── Lifecycle Action Schemas ────────────────────────────────────────────────

/**
 * Schema for suspending a tenant.
 */
export const SuspendTenantSchema = Type.Object({
  reason: Type.String({ minLength: 1, maxLength: 500, description: 'Reason for suspension' }),
});

export type SuspendTenantInput = Static<typeof SuspendTenantSchema>;

/**
 * Schema for decommissioning a tenant.
 */
export const DecommissionTenantSchema = Type.Object({
  reason: Type.String({ minLength: 1, maxLength: 500, description: 'Reason for decommission' }),
  retainDataDays: Type.Optional(
    Type.Number({
      minimum: 0,
      maximum: 365,
      default: 30,
      description: 'Days to retain data before permanent deletion',
    }),
  ),
  exportData: Type.Optional(
    Type.Boolean({ default: true, description: 'Whether to export data before decommission' }),
  ),
});

export type DecommissionTenantInput = Static<typeof DecommissionTenantSchema>;

/**
 * Schema for updating tenant configuration.
 */
export const UpdateConfigSchema = Type.Object({
  branding: Type.Optional(BrandingConfigSchema),
  locale: Type.Optional(LocaleConfigSchema),
  features: Type.Optional(FeatureConfigSchema),
  security: Type.Optional(SecurityConfigSchema),
});

export type UpdateConfigInput = Static<typeof UpdateConfigSchema>;

// ─── Domain Schemas ──────────────────────────────────────────────────────────

/**
 * Schema for adding a custom domain to a tenant.
 */
export const AddDomainSchema = Type.Object({
  domain: Type.String({
    minLength: 4,
    maxLength: 253,
    description: 'Custom domain (e.g., "edu.ministry.gov")',
  }),
  primary: Type.Optional(
    Type.Boolean({ default: false, description: 'Whether this is the primary domain' }),
  ),
});

export type AddDomainInput = Static<typeof AddDomainSchema>;

// ─── Branding Versioning Schemas (Task 58.2) ─────────────────────────────────

/**
 * Schema for publishing a new tenant branding revision.
 *
 * Each publish appends a row to `tenant_theme_versions` and copies the
 * tokens onto `tenant_settings.theme` (Design §N — versioned revisions).
 */
export const PublishBrandingSchema = Type.Object({
  tokens: ThemeTokensSchema,
  publishedBy: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'UUID of the user publishing the revision',
  }),
});

export type PublishBrandingInput = Static<typeof PublishBrandingSchema>;

/**
 * Schema for `POST /api/v1/tenant/branding/rollback`.
 *
 * `revision` identifies the prior `tenant_theme_versions` row whose tokens
 * should be re-applied. The rollback itself is appended as a new row at the
 * next revision number — the table is never mutated.
 */
export const RollbackBrandingSchema = Type.Object({
  revision: Type.Integer({
    minimum: 1,
    description: 'The revision number to roll back to (must be a prior revision for the tenant)',
  }),
  publishedBy: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'UUID of the user performing the rollback (recorded on the new audit row)',
  }),
});

export type RollbackBrandingInput = Static<typeof RollbackBrandingSchema>;

// ─── Branding Draft Schemas (Task 58.3) ──────────────────────────────────────

/**
 * Schema for `POST /api/v1/tenant/branding/draft`.
 *
 * Stores in-progress branding token edits independently of the published
 * revision (Task 58.3). A tenant has at most one draft at a time — saving
 * again replaces the prior draft. The draft is only ever surfaced to clients
 * that present the `Tenant-Theme-Preview` cookie OR
 * `X-Tenant-Theme-Preview` header AND carry the `branding:preview`
 * permission (Design §N).
 */
export const SaveBrandingDraftSchema = Type.Object({
  tokens: ThemeTokensSchema,
  savedBy: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'UUID of the user saving the draft',
  }),
});

export type SaveBrandingDraftInput = Static<typeof SaveBrandingDraftSchema>;

/**
 * Response payload for tenant branding draft reads / writes.
 */
export const TenantBrandingDraftResponseSchema = Type.Object({
  tenantId: Type.String({ description: 'Tenant UUID' }),
  tokens: ThemeTokensSchema,
  savedAt: Type.String({ description: 'Last save timestamp (ISO 8601)' }),
  savedBy: Type.String({ description: 'UUID of the user who last saved the draft' }),
});

export type TenantBrandingDraftResponse = Static<typeof TenantBrandingDraftResponseSchema>;

/**
 * Response payload for `GET /api/v1/tenant/branding/active` (Task 58.3).
 *
 * `source` distinguishes whether the tokens are from a draft preview or the
 * currently published revision. Clients (and tests) use it to render the
 * "Preview banner" described in Design §N.
 */
export const ActiveBrandingResponseSchema = Type.Object({
  tokens: Type.Union([ThemeTokensSchema, Type.Null()]),
  revision: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  source: Type.Union([Type.Literal('published'), Type.Literal('draft')]),
});

export type ActiveBrandingResponse = Static<typeof ActiveBrandingResponseSchema>;

/**
 * Response payload for branding publish / rollback operations.
 */
export const TenantThemeVersionResponseSchema = Type.Object({
  id: Type.String({ description: 'Theme version UUID' }),
  tenantId: Type.String({ description: 'Tenant UUID' }),
  revision: Type.Integer({
    description: 'Monotonically increasing revision number for this tenant',
  }),
  tokens: ThemeTokensSchema,
  publishedAt: Type.String({ description: 'Publish timestamp (ISO 8601)' }),
  publishedBy: Type.String({ description: 'UUID of the publisher' }),
});

export type TenantThemeVersionResponse = Static<typeof TenantThemeVersionResponseSchema>;

// ─── Response Schemas ────────────────────────────────────────────────────────

/**
 * Schema for tenant response object.
 */
export const TenantResponseSchema = Type.Object({
  id: Type.String({ description: 'Tenant UUID' }),
  name: Type.String({ description: 'Tenant organization name' }),
  slug: Type.String({ description: 'URL-safe slug' }),
  status: TenantStatusEnum,
  plan: Type.Union([Type.String(), Type.Null()], { description: 'Plan identifier' }),
  region: Type.Union([Type.String(), Type.Null()], { description: 'Deployment region' }),
  config: TenantConfigSchema,
  suspendedAt: Type.Union([Type.String(), Type.Null()], {
    description: 'Suspension timestamp (ISO 8601)',
  }),
  suspendedReason: Type.Union([Type.String(), Type.Null()], { description: 'Suspension reason' }),
  decommissionedAt: Type.Union([Type.String(), Type.Null()], {
    description: 'Decommission timestamp (ISO 8601)',
  }),
  dataRetentionUntil: Type.Union([Type.String(), Type.Null()], {
    description: 'Data retention deadline (ISO 8601)',
  }),
  createdAt: Type.String({ description: 'Creation timestamp (ISO 8601)' }),
  updatedAt: Type.String({ description: 'Last update timestamp (ISO 8601)' }),
});

export type TenantResponse = Static<typeof TenantResponseSchema>;

/**
 * Schema for paginated tenant list response.
 */
export const TenantListResponseSchema = Type.Object({
  data: Type.Array(TenantResponseSchema),
  meta: Type.Object({
    page: Type.Number({ description: 'Current page number' }),
    pageSize: Type.Number({ description: 'Items per page' }),
    totalItems: Type.Number({ description: 'Total number of items' }),
    totalPages: Type.Number({ description: 'Total number of pages' }),
  }),
});

export type TenantListResponse = Static<typeof TenantListResponseSchema>;

/**
 * Schema for tenant usage dashboard response.
 */
export const TenantUsageResponseSchema = Type.Object({
  tenantId: Type.String({ description: 'Tenant UUID' }),
  storage: Type.Object({
    usedBytes: Type.Number({ description: 'Storage used in bytes' }),
    limitBytes: Type.Number({ description: 'Storage limit in bytes (-1 for unlimited)' }),
    percentage: Type.Number({ description: 'Usage percentage (0-100)' }),
  }),
  users: Type.Object({
    active: Type.Number({ description: 'Active user count' }),
    total: Type.Number({ description: 'Total user count' }),
    limit: Type.Number({ description: 'User limit (-1 for unlimited)' }),
  }),
  apiCalls: Type.Object({
    current: Type.Number({ description: 'API calls in current period' }),
    limit: Type.Number({ description: 'API call limit per period (-1 for unlimited)' }),
    periodStart: Type.String({ description: 'Period start (ISO 8601)' }),
    periodEnd: Type.String({ description: 'Period end (ISO 8601)' }),
  }),
  lastUpdated: Type.String({ description: 'Last usage data update (ISO 8601)' }),
});

export type TenantUsageResponse = Static<typeof TenantUsageResponseSchema>;

/**
 * Schema for domain response.
 */
export const DomainResponseSchema = Type.Object({
  id: Type.String({ description: 'Domain UUID' }),
  tenantId: Type.String({ description: 'Tenant UUID' }),
  domain: Type.String({ description: 'Domain name' }),
  primary: Type.Boolean({ description: 'Whether this is the primary domain' }),
  verified: Type.Boolean({ description: 'Whether the domain is verified' }),
  createdAt: Type.String({ description: 'Creation timestamp (ISO 8601)' }),
});

export type DomainResponse = Static<typeof DomainResponseSchema>;
