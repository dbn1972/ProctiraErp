/**
 * @proctira/backend-theme - Theme Architecture Service
 *
 * Provides theme management with:
 * - Token-based theme system (colors, typography, spacing, shadows)
 * - Theme levels: platform default, tenant, portal-specific
 * - Theme versioning with revision history
 * - Preview mode (view before publish)
 * - Accessibility validation (contrast ratios, font sizes)
 * - Theme inheritance (platform → tenant → portal)
 *
 * Storage tables: theme_themes, theme_revisions, theme_tokens, theme_assets
 */

// Plugin
export { themePlugin } from './theme-plugin.js';
export type { ThemePluginOptions } from './theme-plugin.js';

// Service
export { ThemeService } from './theme-service.js';
export type { ThemeServiceConfig } from './theme-service.js';

// Repository
export type {
  ThemeEntity,
  ThemeRevisionEntity,
  ThemeFilter,
  ThemeRepository,
} from './theme-repository.js';

// In-memory repository (for testing)
export { InMemoryThemeRepository } from './in-memory-repository.js';

// Schemas
export {
  ThemeLevelSchema,
  ThemeStatusSchema,
  TypographyConfigSchema,
  SpacingConfigSchema,
  ThemeTokensSchema,
  ThemeAssetsSchema,
  CreateThemeSchema,
  UpdateThemeSchema,
  PublishThemeSchema,
  RollbackThemeSchema,
  ThemeParamsSchema,
  ThemeRevisionParamsSchema,
  ThemeListQuerySchema,
  ThemeResponseSchema,
  ThemeRevisionResponseSchema,
  ThemePreviewResponseSchema,
  AccessibilityResultSchema,
} from './schemas.js';
export type {
  ThemeLevel,
  ThemeStatus,
  TypographyConfig,
  SpacingConfig,
  ThemeTokens,
  ThemeAssets,
  CreateThemeInput,
  UpdateThemeInput,
  PublishThemeInput,
  RollbackThemeInput,
  ThemeParams,
  ThemeRevisionParams,
  ThemeListQuery,
  ThemeResponse,
  ThemeRevisionResponse,
  ThemePreviewResponse,
  AccessibilityResult,
} from './schemas.js';

// Routes
export { registerThemeRoutes } from './routes.js';
export type { ThemeRoutesOptions } from './routes.js';

// Accessibility
export {
  validateAccessibility,
  contrastRatio,
  relativeLuminance,
  parseColor,
  hexToRgb,
  hslToRgb,
} from './accessibility.js';
export type { AccessibilityIssue } from './accessibility.js';
