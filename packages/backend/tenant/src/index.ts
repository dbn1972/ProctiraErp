/**
 * @proctira/backend-tenant - Tenant Lifecycle Service
 *
 * Provides tenant management with:
 * - Tenant CRUD (create, update, get, list)
 * - Tenant provisioning workflow (create record, seed defaults, create admin)
 * - Tenant lifecycle management (active, suspended, decommissioned)
 * - Tenant configuration management (branding, locale, timezone, features, security)
 * - Tenant domain management (custom domains)
 * - Tenant usage dashboard (storage, users, API calls)
 * - Data retention enforcement for decommissioned tenants
 *
 * Charter: Section 6 (Tenant Model)
 */

// Plugin
export { tenantLifecyclePlugin } from './tenant-plugin.js';
export type { TenantPluginOptions } from './tenant-plugin.js';

// Service
export { TenantService } from './tenant-service.js';

// Repository
export type {
  TenantEntity,
  DomainEntity,
  TenantUsageEntity,
  TenantThemeVersionEntity,
  TenantBrandingDraftEntity,
  TenantFilter,
  TenantRepository,
} from './tenant-repository.js';

// In-memory repository (for testing)
export { InMemoryTenantRepository } from './in-memory-repository.js';
// Postgres repository + factory (G-704)
export { PgTenantRepository } from './pg-tenant-repository.js';
export { createTenantRepository } from './create-tenant-repository.js';
export type { TenantPersistence } from './create-tenant-repository.js';

// Schemas
export {
  TenantStatusEnum,
  BrandingConfigSchema,
  LocaleConfigSchema,
  FeatureConfigSchema,
  SecurityConfigSchema,
  TenantConfigSchema,
  ThemeTokensSchema,
  CreateTenantSchema,
  UpdateTenantSchema,
  TenantParamsSchema,
  TenantListQuerySchema,
  SuspendTenantSchema,
  DecommissionTenantSchema,
  UpdateConfigSchema,
  AddDomainSchema,
  PublishBrandingSchema,
  RollbackBrandingSchema,
  SaveBrandingDraftSchema,
  TenantThemeVersionResponseSchema,
  TenantBrandingDraftResponseSchema,
  ActiveBrandingResponseSchema,
  TenantResponseSchema,
  TenantListResponseSchema,
  TenantUsageResponseSchema,
  DomainResponseSchema,
} from './schemas.js';
export type {
  TenantStatus,
  BrandingConfig,
  LocaleConfig,
  FeatureConfig,
  SecurityConfig,
  TenantConfig,
  ThemeTokens,
  CreateTenantInput,
  UpdateTenantInput,
  TenantParams,
  TenantListQuery,
  SuspendTenantInput,
  DecommissionTenantInput,
  UpdateConfigInput,
  AddDomainInput,
  PublishBrandingInput,
  RollbackBrandingInput,
  SaveBrandingDraftInput,
  TenantThemeVersionResponse,
  TenantBrandingDraftResponse,
  ActiveBrandingResponse,
  TenantResponse,
  TenantListResponse,
  TenantUsageResponse,
  DomainResponse,
} from './schemas.js';

// Routes
export { registerTenantRoutes } from './routes.js';
export type { TenantRoutesOptions } from './routes.js';
export {
  registerBrandingRoutes,
  PREVIEW_COOKIE_NAME,
  PREVIEW_HEADER_NAME,
} from './branding-routes.js';
export type {
  BrandingRoutesOptions,
  BrandingPermissionResolver,
  TenantIdResolver,
} from './branding-routes.js';

// Roles & Permissions (Task 59.3 / Requirement 42 AC 4–5)
export { RolesService } from './roles-service.js';
export type {
  CreateRoleInput as CreateRoleServiceInput,
  RolesAuditEvent,
  RolesAuditOperation,
  RolesAuditEmitter,
  UpdateRoleInput as UpdateRoleServiceInput,
} from './roles-service.js';
export type {
  PermissionRef,
  RoleEntity,
  RolesRepository,
  UserListFilter,
  UserRecord,
} from './roles-repository.js';
export { InMemoryRolesRepository } from './in-memory-roles-repository.js';
export type { BuiltInRoleSeed } from './in-memory-roles-repository.js';
export {
  AssignRolesToUserSchema,
  CreateRoleSchema,
  ListUsersQuerySchema,
  PermissionActionEnum,
  PermissionRefSchema,
  RoleParamsSchema,
  UpdateRolePermissionsSchema,
  UpdateRoleSchema,
  UserParamsSchema,
} from './roles-schemas.js';
export type {
  AssignRolesToUserInput,
  CreateRoleInput,
  ListUsersQuery,
  RoleParams,
  UpdateRoleInput,
  UpdateRolePermissionsInput,
  UserParams,
} from './roles-schemas.js';
export { registerRolesRoutes } from './roles-routes.js';
export type { RolesRoutesOptions } from './roles-routes.js';
