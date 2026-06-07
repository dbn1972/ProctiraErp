/**
 * Theme Schemas
 *
 * Typebox schemas for theme token validation, CRUD operations,
 * and API request/response shapes.
 *
 * Supports:
 * - Token-based theme system (colors, typography, spacing, shadows)
 * - Theme levels: platform default, tenant, portal-specific
 * - Theme versioning with revision history
 * - Preview mode
 * - Accessibility validation (contrast ratios, font sizes)
 */
import { Type, type Static } from '@sinclair/typebox';

/** UUID v4 pattern for validation */
const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const UuidString = () => Type.String({ pattern: UUID_PATTERN, description: 'UUID v4 identifier' });

// ─── Theme Level ──────────────────────────────────────────────────────────────

export const ThemeLevelSchema = Type.Union([
  Type.Literal('platform'),
  Type.Literal('tenant'),
  Type.Literal('portal'),
]);

export type ThemeLevel = Static<typeof ThemeLevelSchema>;

// ─── Theme Status ─────────────────────────────────────────────────────────────

export const ThemeStatusSchema = Type.Union([
  Type.Literal('draft'),
  Type.Literal('published'),
  Type.Literal('archived'),
]);

export type ThemeStatus = Static<typeof ThemeStatusSchema>;

// ─── Color Token (HSL format) ─────────────────────────────────────────────────

/**
 * HSL color string pattern: hsl(0-360, 0-100%, 0-100%) or hex #rrggbb
 */
const ColorValueSchema = Type.String({
  minLength: 4,
  maxLength: 50,
  description: 'Color value in HSL (e.g., hsl(220, 70%, 50%)) or hex (e.g., #3366cc)',
});

// ─── Typography Config ────────────────────────────────────────────────────────

export const TypographyConfigSchema = Type.Object({
  fontFamily: Type.String({ minLength: 1, maxLength: 255, description: 'Primary font family' }),
  fontFamilyHeading: Type.Optional(Type.String({ maxLength: 255, description: 'Heading font family' })),
  baseFontSize: Type.Number({ minimum: 12, maximum: 24, description: 'Base font size in px (min 12px for accessibility)' }),
  lineHeight: Type.Number({ minimum: 1.2, maximum: 2.0, description: 'Base line height ratio' }),
  fontWeightNormal: Type.Optional(Type.Number({ minimum: 100, maximum: 900 })),
  fontWeightBold: Type.Optional(Type.Number({ minimum: 100, maximum: 900 })),
  scaleRatio: Type.Optional(Type.Number({ minimum: 1.1, maximum: 1.5, description: 'Type scale ratio' })),
});

export type TypographyConfig = Static<typeof TypographyConfigSchema>;

// ─── Spacing Config ───────────────────────────────────────────────────────────

export const SpacingConfigSchema = Type.Object({
  unit: Type.Number({ minimum: 2, maximum: 16, description: 'Base spacing unit in px' }),
  scale: Type.Optional(Type.Array(Type.Number({ minimum: 0 }), { maxItems: 20, description: 'Spacing scale multipliers' })),
});

export type SpacingConfig = Static<typeof SpacingConfigSchema>;

// ─── Theme Tokens ─────────────────────────────────────────────────────────────

export const ThemeTokensSchema = Type.Object({
  colors: Type.Record(Type.String(), ColorValueSchema, {
    description: 'Color tokens (e.g., primary, secondary, background, surface, error, warning, success)',
  }),
  typography: TypographyConfigSchema,
  spacing: SpacingConfigSchema,
  borderRadius: Type.Optional(Type.Record(Type.String(), Type.String(), {
    description: 'Border radius tokens (e.g., sm, md, lg, full)',
  })),
  shadows: Type.Optional(Type.Record(Type.String(), Type.String(), {
    description: 'Shadow tokens (e.g., sm, md, lg, xl)',
  })),
  darkMode: Type.Optional(Type.Boolean({ description: 'Whether dark mode is enabled' })),
});

export type ThemeTokens = Static<typeof ThemeTokensSchema>;

// ─── Theme Assets ─────────────────────────────────────────────────────────────

export const ThemeAssetsSchema = Type.Object({
  logoUrl: Type.Optional(Type.String({ maxLength: 2048, description: 'Logo URL' })),
  logoAlt: Type.Optional(Type.String({ maxLength: 255, description: 'Logo alt text' })),
  faviconUrl: Type.Optional(Type.String({ maxLength: 2048, description: 'Favicon URL' })),
});

export type ThemeAssets = Static<typeof ThemeAssetsSchema>;

// ─── Create Theme ─────────────────────────────────────────────────────────────

export const CreateThemeSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Theme name' }),
  description: Type.Optional(Type.String({ maxLength: 1000 })),
  level: ThemeLevelSchema,
  portalId: Type.Optional(UuidString()),
  tokens: ThemeTokensSchema,
  assets: Type.Optional(ThemeAssetsSchema),
});

export type CreateThemeInput = Static<typeof CreateThemeSchema>;

// ─── Update Theme ─────────────────────────────────────────────────────────────

export const UpdateThemeSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  description: Type.Optional(Type.String({ maxLength: 1000 })),
  tokens: Type.Optional(ThemeTokensSchema),
  assets: Type.Optional(ThemeAssetsSchema),
});

export type UpdateThemeInput = Static<typeof UpdateThemeSchema>;

// ─── Publish Theme ────────────────────────────────────────────────────────────

export const PublishThemeSchema = Type.Object({
  commitMessage: Type.Optional(Type.String({ maxLength: 500, description: 'Revision commit message' })),
});

export type PublishThemeInput = Static<typeof PublishThemeSchema>;

// ─── Rollback Theme ───────────────────────────────────────────────────────────

export const RollbackThemeSchema = Type.Object({
  revisionId: UuidString(),
  reason: Type.Optional(Type.String({ maxLength: 500 })),
});

export type RollbackThemeInput = Static<typeof RollbackThemeSchema>;

// ─── Route Params ─────────────────────────────────────────────────────────────

export const ThemeParamsSchema = Type.Object({
  themeId: UuidString(),
});

export type ThemeParams = Static<typeof ThemeParamsSchema>;

export const ThemeRevisionParamsSchema = Type.Object({
  themeId: UuidString(),
  revisionId: UuidString(),
});

export type ThemeRevisionParams = Static<typeof ThemeRevisionParamsSchema>;

// ─── Query Params ─────────────────────────────────────────────────────────────

export const ThemeListQuerySchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
  level: Type.Optional(ThemeLevelSchema),
  status: Type.Optional(ThemeStatusSchema),
});

export type ThemeListQuery = Static<typeof ThemeListQuerySchema>;

// ─── Response Schemas ─────────────────────────────────────────────────────────

export const ThemeResponseSchema = Type.Object({
  id: UuidString(),
  tenantId: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  level: ThemeLevelSchema,
  portalId: Type.Union([UuidString(), Type.Null()]),
  status: ThemeStatusSchema,
  tokens: ThemeTokensSchema,
  assets: Type.Union([ThemeAssetsSchema, Type.Null()]),
  currentRevision: Type.Union([Type.Number(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type ThemeResponse = Static<typeof ThemeResponseSchema>;

export const ThemeRevisionResponseSchema = Type.Object({
  id: UuidString(),
  themeId: UuidString(),
  revisionNumber: Type.Number(),
  tokens: ThemeTokensSchema,
  assets: Type.Union([ThemeAssetsSchema, Type.Null()]),
  commitMessage: Type.Union([Type.String(), Type.Null()]),
  publishedBy: Type.String(),
  publishedAt: Type.String(),
});

export type ThemeRevisionResponse = Static<typeof ThemeRevisionResponseSchema>;

export const ThemePreviewResponseSchema = Type.Object({
  themeId: UuidString(),
  tokens: ThemeTokensSchema,
  assets: Type.Union([ThemeAssetsSchema, Type.Null()]),
  accessibilityResult: Type.Object({
    valid: Type.Boolean(),
    issues: Type.Array(Type.Object({
      type: Type.String(),
      message: Type.String(),
      severity: Type.Union([Type.Literal('error'), Type.Literal('warning')]),
    })),
  }),
});

export type ThemePreviewResponse = Static<typeof ThemePreviewResponseSchema>;

export const AccessibilityResultSchema = Type.Object({
  valid: Type.Boolean(),
  issues: Type.Array(Type.Object({
    type: Type.String(),
    message: Type.String(),
    severity: Type.Union([Type.Literal('error'), Type.Literal('warning')]),
  })),
});

export type AccessibilityResult = Static<typeof AccessibilityResultSchema>;
