/**
 * Plugin Schemas
 *
 * Typebox schemas for plugin manifest validation, CRUD operations,
 * and API request/response shapes.
 */
import { Type, type Static } from '@sinclair/typebox';

/** UUID v4 pattern for validation */
const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const UuidString = () => Type.String({ pattern: UUID_PATTERN, description: 'UUID v4 identifier' });

// ─── Plugin Manifest Schema ───────────────────────────────────────────────────

/**
 * Semver pattern: major.minor.patch with optional pre-release
 */
const SemverSchema = Type.String({
  pattern: '^\\d+\\.\\d+\\.\\d+(-[a-zA-Z0-9.]+)?$',
  description: 'Semantic version (e.g., 1.0.0, 2.1.0-beta.1)',
});

/**
 * Semver range pattern for compatibility (e.g., ">=1.0.0 <2.0.0", "^1.2.0", "~1.0.0")
 */
const SemverRangeSchema = Type.String({
  minLength: 1,
  maxLength: 100,
  description: 'Semver range for product version compatibility',
});

/**
 * Tenant scope behavior: isolated (per-tenant data) or shared (cross-tenant)
 */
export const TenantScopeBehaviorSchema = Type.Union([
  Type.Literal('isolated'),
  Type.Literal('shared'),
]);

/**
 * Plugin manifest as declared by the plugin author.
 * This is the core contract between a plugin and the platform.
 */
export const PluginManifestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z0-9-]+$' }),
  owner: Type.String({ minLength: 1, maxLength: 255 }),
  version: SemverSchema,
  supportedProductVersions: SemverRangeSchema,
  requiredPermissions: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { minItems: 0 }),
  requiredExtensionPoints: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
    minItems: 0,
  }),
  configSchema: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  runtimeDependencies: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { minItems: 0 }),
  tenantScopeBehavior: TenantScopeBehaviorSchema,
  auditBehavior: Type.String({ minLength: 1, maxLength: 500 }),
});

export type PluginManifest = Static<typeof PluginManifestSchema>;

// ─── Plugin Registration (Register a plugin in the registry) ──────────────────

export const RegisterPluginSchema = Type.Object({
  manifest: PluginManifestSchema,
  description: Type.Optional(Type.String({ maxLength: 1000 })),
  category: Type.Optional(
    Type.Union([
      Type.Literal('ui-extension'),
      Type.Literal('workflow'),
      Type.Literal('event-handler'),
      Type.Literal('integration-connector'),
      Type.Literal('validation'),
      Type.Literal('notification'),
      Type.Literal('reporting'),
      Type.Literal('theme-extension'),
      Type.Literal('developer-tooling'),
    ]),
  ),
});

export type RegisterPluginInput = Static<typeof RegisterPluginSchema>;

// ─── Plugin Install (Install a plugin for a tenant) ───────────────────────────

export const InstallPluginSchema = Type.Object({
  pluginId: UuidString(),
  consentedPermissions: Type.Array(Type.String({ minLength: 1, maxLength: 128 })),
  configuration: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export type InstallPluginInput = Static<typeof InstallPluginSchema>;

// ─── Plugin Enable/Disable ────────────────────────────────────────────────────

export const PluginInstallParamsSchema = Type.Object({
  installId: UuidString(),
});

export type PluginInstallParams = Static<typeof PluginInstallParamsSchema>;

// ─── Plugin Uninstall ─────────────────────────────────────────────────────────

export const UninstallPluginSchema = Type.Object({
  reason: Type.Optional(Type.String({ maxLength: 500 })),
});

export type UninstallPluginInput = Static<typeof UninstallPluginSchema>;

// ─── Plugin Params ────────────────────────────────────────────────────────────

export const PluginParamsSchema = Type.Object({
  pluginId: UuidString(),
});

export type PluginParams = Static<typeof PluginParamsSchema>;

// ─── Plugin List Query ────────────────────────────────────────────────────────

export const PluginListQuerySchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
  category: Type.Optional(Type.String()),
  search: Type.Optional(Type.String()),
});

export type PluginListQuery = Static<typeof PluginListQuerySchema>;

// ─── Response Schemas ─────────────────────────────────────────────────────────

export const PluginResponseSchema = Type.Object({
  id: UuidString(),
  name: Type.String(),
  owner: Type.String(),
  version: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  category: Type.Union([Type.String(), Type.Null()]),
  status: Type.String(),
  supportedProductVersions: Type.String(),
  requiredPermissions: Type.Array(Type.String()),
  requiredExtensionPoints: Type.Array(Type.String()),
  tenantScopeBehavior: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type PluginResponse = Static<typeof PluginResponseSchema>;

export const PluginInstallResponseSchema = Type.Object({
  id: UuidString(),
  pluginId: UuidString(),
  tenantId: UuidString(),
  status: Type.String(),
  consentedPermissions: Type.Array(Type.String()),
  configuration: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  installedAt: Type.String(),
  updatedAt: Type.String(),
});

export type PluginInstallResponse = Static<typeof PluginInstallResponseSchema>;
