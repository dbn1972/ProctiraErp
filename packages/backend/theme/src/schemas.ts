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
 * Strict color grammar (PRC-M393/M394): hex #rgb/#rrggbb/#rrggbbaa, hsl()/hsla()
 * or rgb()/rgba(). Anything else (named colors, `red; } body{...}`, url(...))
 * is rejected so tokens are safe to interpolate into CSS.
 */
export const COLOR_VALUE_PATTERN =
  '^(?:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})' +
  '|hsla?\\(\\s*\\d{1,3}\\s*[,\\s]\\s*\\d{1,3}%\\s*[,\\s]\\s*\\d{1,3}%\\s*(?:[,/]\\s*(?:0|1|0?\\.\\d+|\\d{1,3}%)\\s*)?\\)' +
  '|rgba?\\(\\s*\\d{1,3}\\s*[,\\s]\\s*\\d{1,3}\\s*[,\\s]\\s*\\d{1,3}\\s*(?:[,/]\\s*(?:0|1|0?\\.\\d+|\\d{1,3}%)\\s*)?\\))$';
const ColorValueSchema = Type.String({
  minLength: 4,
  maxLength: 50,
  pattern: COLOR_VALUE_PATTERN,
  description: 'Color value: hex (#3366cc), hsl(220, 70%, 50%) or rgb(51, 102, 204)',
});
/** Token key names: identifier-like only (PRC-M394). */
export const TOKEN_KEY_PATTERN = '^[a-zA-Z0-9_-]{1,64}$';
const TokenKey = () => Type.String({ pattern: TOKEN_KEY_PATTERN });
/** CSS length: 0, or a number with px/rem/em/% unit (PRC-M394). */
export const CSS_LENGTH_PATTERN = '^(?:0|\\d{1,4}(?:\\.\\d{1,3})?(?:px|rem|em|%))$';
/**
 * box-shadow grammar subset: `none` or lengths/colors/`inset` separated by
 * spaces/commas. No semicolons, braces, colons, slashes, quotes or url() so values cannot break out of a
 * declaration or load remote resources (PRC-M394).
 */
export const CSS_SHADOW_PATTERN = '^(?!.*url\\()(?:none|[-0-9a-zA-Z.,#%()\\s]{1,200})$';
/** Font family list: letters, digits, spaces, commas, hyphen, underscore, single quotes. */
export const FONT_FAMILY_PATTERN = "^[a-zA-Z0-9 ,'_-]{1,255}$";
/** Asset URLs must be https (no javascript:, data:, http:) (PRC-M394). */
export const HTTPS_URL_PATTERN = '^https://[^\\s"\'<>()\\\\`]+$';
// ─── Typography Config ────────────────────────────────────────────────────────

export const TypographyConfigSchema = Type.Object({
  fontFamily: Type.String({
    minLength: 1,
    maxLength: 255,
    pattern: FONT_FAMILY_PATTERN,
    description: 'Primary font family',
  }),
  fontFamilyHeading: Type.Optional(
    Type.String({ maxLength: 255, pattern: FONT_FAMILY_PATTERN, description: 'Heading font family' }),
  ),
  baseFontSize: Type.Number({
    minimum: 12,
    maximum: 24,
    description: 'Base font size in px (min 12px for accessibility)',
  }),
  lineHeight: Type.Number({ minimum: 1.2, maximum: 2.0, description: 'Base line height ratio' }),
  fontWeightNormal: Type.Optional(Type.Number({ minimum: 100, maximum: 900 })),
  fontWeightBold: Type.Optional(Type.Number({ minimum: 100, maximum: 900 })),
  scaleRatio: Type.Optional(
    Type.Number({ minimum: 1.1, maximum: 1.5, description: 'Type scale ratio' }),
  ),
});

export type TypographyConfig = Static<typeof TypographyConfigSchema>;

// ─── Spacing Config ───────────────────────────────────────────────────────────

export const SpacingConfigSchema = Type.Object({
  unit: Type.Number({ minimum: 2, maximum: 16, description: 'Base spacing unit in px' }),
  scale: Type.Optional(
    Type.Array(Type.Number({ minimum: 0 }), {
      maxItems: 20,
      description: 'Spacing scale multipliers',
    }),
  ),
});

export type SpacingConfig = Static<typeof SpacingConfigSchema>;

// ─── Theme Tokens ─────────────────────────────────────────────────────────────

export const ThemeTokensSchema = Type.Object({
  colors: Type.Record(TokenKey(), ColorValueSchema, {
    description:
      'Color tokens (e.g., primary, secondary, background, surface, error, warning, success)',
      additionalProperties: false,
  }),
  typography: TypographyConfigSchema,
  spacing: SpacingConfigSchema,
  borderRadius: Type.Optional(
    Type.Record(TokenKey(), Type.String({ pattern: CSS_LENGTH_PATTERN }), {
      description: 'Border radius tokens (e.g., sm, md, lg, full)',
      additionalProperties: false,
    }),
  ),
  shadows: Type.Optional(
    Type.Record(TokenKey(), Type.String({ pattern: CSS_SHADOW_PATTERN }), {
      description: 'Shadow tokens (e.g., sm, md, lg, xl)',
      additionalProperties: false,
    }),
  ),
  darkMode: Type.Optional(Type.Boolean({ description: 'Whether dark mode is enabled' })),
});

export type ThemeTokens = Static<typeof ThemeTokensSchema>;

// ─── Theme Assets ─────────────────────────────────────────────────────────────

export const ThemeAssetsSchema = Type.Object({
  logoUrl: Type.Optional(
    Type.String({ maxLength: 2048, pattern: HTTPS_URL_PATTERN, description: 'Logo URL (https)' }),
  ),
  logoAlt: Type.Optional(Type.String({ maxLength: 255, description: 'Logo alt text' })),
  faviconUrl: Type.Optional(
    Type.String({ maxLength: 2048, pattern: HTTPS_URL_PATTERN, description: 'Favicon URL (https)' }),
  ),
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
  commitMessage: Type.Optional(
    Type.String({ maxLength: 500, description: 'Revision commit message' }),
  ),
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
    issues: Type.Array(
      Type.Object({
        type: Type.String(),
        message: Type.String(),
        severity: Type.Union([Type.Literal('error'), Type.Literal('warning')]),
      }),
    ),
  }),
});

export type ThemePreviewResponse = Static<typeof ThemePreviewResponseSchema>;

export const AccessibilityResultSchema = Type.Object({
  valid: Type.Boolean(),
  issues: Type.Array(
    Type.Object({
      type: Type.String(),
      message: Type.String(),
      severity: Type.Union([Type.Literal('error'), Type.Literal('warning')]),
    }),
  ),
});

export type AccessibilityResult = Static<typeof AccessibilityResultSchema>;
