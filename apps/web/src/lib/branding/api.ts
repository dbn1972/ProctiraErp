/**
 * Tenant branding API client (Task 59.2 → Task 60A.9 backend wiring).
 *
 * Talks to the gateway endpoints registered by
 * `@proctira/backend-tenant/branding-routes`:
 *
 *   GET   /api/v1/tenant/branding           → currently published tokens
 *   GET   /api/v1/tenant/branding/draft     → saved draft (or null)
 *   POST  /api/v1/tenant/branding/draft     → upsert the draft
 *   POST  /api/v1/tenant/branding/publish   → publish a new revision
 *   POST  /api/v1/tenant/branding/rollback  → rollback to a prior revision
 *   PATCH /api/v1/tenant/branding           → partial update of branding config
 *
 * The Settings → Branding page reads `{ draft, published }` and lets the
 * user edit the draft, toggle the preview cookie (Task 58.3), or publish
 * the draft as a new revision (Task 58.4 — server-side guards run here
 * and surface field-level errors).
 *
 * All requests go through `browserGatewayFetch` which handles:
 *   • Auth cookie forwarding (`credentials: 'include'`)
 *   • Tenant resolution via JWT claim / X-Tenant-ID header
 *   • Consistent error handling via `BrowserGatewayError`
 *
 * Errors:
 *   • Validation errors from `POST /publish` carry `errors: FieldError[]`
 *     where each entry has `{ field, rule, message }`. The page maps the
 *     field path (e.g. `tokens.--tenant-primary`) to its inline error
 *     slot via `mapPublishErrorsToFields()`.
 *   • Network / 5xx failures throw `BrowserGatewayError` with `status`,
 *     `code`, and `message`.
 */

import {
  browserGatewayFetch,
} from '@/lib/api/browser-gateway';

// Re-export AdminApiError for backwards compatibility with the page.
// The page catches `AdminApiError` — we alias `BrowserGatewayError` so
// existing error-handling logic continues to work without changes.
export { BrowserGatewayError as AdminApiError } from '@/lib/api/browser-gateway';

// ─── Endpoint paths ──────────────────────────────────────────────────────

export const BRANDING_API_ENDPOINTS = {
  /** GET: active (published) branding tokens. PATCH: partial update. */
  ACTIVE: '/tenant/branding',
  /** GET: saved draft. POST: upsert draft. */
  DRAFT: '/tenant/branding/draft',
  /** POST: publish a new revision (runs server-side validation guards). */
  PUBLISH: '/tenant/branding/publish',
  /** POST: rollback to a prior revision. */
  ROLLBACK: '/tenant/branding/rollback',
} as const;

// ─── Token shape (matches the backend `ThemeTokens` record) ──────────────

/**
 * Free-form theme-token record. The Settings → Branding form writes the
 * canonical `--tenant-*` tokens recognised by Design §M / §N:
 *
 *   --tenant-logo, --tenant-favicon,
 *   --tenant-primary, --tenant-accent,
 *   --tenant-login-bg
 *
 * Other token names are passed through unchanged so future fields
 * (sidebar bg, custom CSS, …) can extend the form without changing the
 * client contract.
 */
export type BrandingTokens = Record<string, unknown>;

export interface PublishedBranding {
  tokens: BrandingTokens;
  revision: number;
  publishedAt: string;
  publishedBy: string;
}

export interface DraftBranding {
  tokens: BrandingTokens;
  savedAt: string;
  savedBy: string;
}

/**
 * Result returned by `getBrandingState()` — the page renders both the draft
 * (if any) and the currently published revision so the user can compare,
 * preview, or revert.
 */
export interface TenantBrandingState {
  draft: DraftBranding | null;
  published: PublishedBranding | null;
}

// ─── Error helpers ───────────────────────────────────────────────────────

export interface BrandingFieldError {
  field: string;
  rule: string;
  message: string;
}

/**
 * Map the publish-time validation errors back to the form field they
 * belong to. The backend reports field paths like `tokens.--tenant-logo`
 * — the form's react-hook-form names are `logoUrl`, `faviconUrl`,
 * `primaryColor`, `accentColor`, and `loginBackground`.
 */
export const PUBLISH_FIELD_TO_FORM_FIELD: Record<string, string> = {
  'tokens.--tenant-logo': 'logoUrl',
  'tokens.--tenant-favicon': 'faviconUrl',
  'tokens.--tenant-primary': 'primaryColor',
  'tokens.--tenant-accent': 'accentColor',
  'tokens.--tenant-login-bg': 'loginBackground',
};

export function mapPublishErrorsToFields(
  errors: readonly BrandingFieldError[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const err of errors) {
    const formField = PUBLISH_FIELD_TO_FORM_FIELD[err.field] ?? err.field;
    // First error wins per field — the user fixes one at a time.
    if (!(formField in out)) out[formField] = err.message;
  }
  return out;
}

// ─── Reads ───────────────────────────────────────────────────────────────

/**
 * Fetch both the published branding and the draft (if any) in parallel.
 *
 * The draft endpoint may 403 when the caller lacks `branding:preview`
 * permission. We treat that as "no draft" so the page still renders.
 */
export async function getBrandingState(): Promise<TenantBrandingState> {
  const [publishedResult, draftResult] = await Promise.allSettled([
    browserGatewayFetch<{
      tokens: BrandingTokens | null;
      revision: number | null;
      source: 'published' | 'draft';
      publishedAt?: string;
      publishedBy?: string;
    }>(BRANDING_API_ENDPOINTS.ACTIVE),
    browserGatewayFetch<DraftBranding | null>(BRANDING_API_ENDPOINTS.DRAFT),
  ]);

  let published: PublishedBranding | null = null;
  if (publishedResult.status === 'fulfilled') {
    const r = publishedResult.value;
    if (r && r.tokens && typeof r.revision === 'number') {
      published = {
        tokens: r.tokens,
        revision: r.revision,
        publishedAt: r.publishedAt ?? '',
        publishedBy: r.publishedBy ?? '',
      };
    }
  }

  let draft: DraftBranding | null = null;
  if (draftResult.status === 'fulfilled' && draftResult.value) {
    draft = draftResult.value;
  }

  return { draft, published };
}

// ─── Writes ──────────────────────────────────────────────────────────────

export interface SaveDraftPayload {
  tokens: BrandingTokens;
  savedBy: string;
}

/**
 * Persist the current form values as a draft. The draft is not versioned
 * and can be overwritten freely. Preview mode reads from this draft.
 */
export async function saveBrandingDraft(
  payload: SaveDraftPayload,
): Promise<DraftBranding> {
  const result = await browserGatewayFetch<DraftBranding>(
    BRANDING_API_ENDPOINTS.DRAFT,
    {
      method: 'POST',
      json: payload,
    },
  );
  return result;
}

export interface PublishBrandingPayload {
  tokens: BrandingTokens;
  publishedBy: string;
}

/**
 * Publish the current form values as a new versioned revision.
 *
 * Server-side guards (Task 58.4) re-validate:
 *   • Logo dimensions ≤ 200 × 60 px
 *   • Favicon 32 × 32 ICO/PNG
 *   • Primary color contrast ≥ 4.5:1 against white
 *   • Accent color contrast ≥ 3:1 against white
 *
 * On validation failure, throws a `BrowserGatewayError` with status 400
 * and `details.errors: BrandingFieldError[]`.
 */
export async function publishBranding(
  payload: PublishBrandingPayload,
): Promise<PublishedBranding> {
  const result = await browserGatewayFetch<{
    id?: string;
    tenantId?: string;
    revision: number;
    tokens: BrandingTokens;
    publishedAt: string;
    publishedBy: string;
  }>(BRANDING_API_ENDPOINTS.PUBLISH, {
    method: 'POST',
    json: payload,
  });
  return {
    tokens: result.tokens,
    revision: result.revision,
    publishedAt: result.publishedAt,
    publishedBy: result.publishedBy,
  };
}

export interface RollbackBrandingPayload {
  /** The revision number to rollback to. */
  version: number;
}

/**
 * Rollback to a previously published revision.
 *
 * This reactivates the specified version's tokens as the current
 * published branding. The rollback is audited as a high-risk event
 * (Requirement 33 AC 4).
 */
export async function rollbackBranding(
  payload: RollbackBrandingPayload,
): Promise<PublishedBranding> {
  const result = await browserGatewayFetch<{
    id?: string;
    tenantId?: string;
    revision: number;
    tokens: BrandingTokens;
    publishedAt: string;
    publishedBy: string;
  }>(BRANDING_API_ENDPOINTS.ROLLBACK, {
    method: 'POST',
    json: payload,
  });
  return {
    tokens: result.tokens,
    revision: result.revision,
    publishedAt: result.publishedAt,
    publishedBy: result.publishedBy,
  };
}

export interface PatchBrandingPayload {
  /** Partial token updates — only the provided keys are merged. */
  tokens?: Partial<BrandingTokens>;
  /** Optional metadata fields. */
  logoUrl?: string;
  faviconUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  loginBackground?: string;
}

/**
 * Partially update the active branding configuration.
 *
 * Unlike `publishBranding` which creates a new versioned revision, PATCH
 * merges the provided fields into the current published state. Useful for
 * quick single-field updates from the admin panel.
 */
export async function patchBranding(
  payload: PatchBrandingPayload,
): Promise<PublishedBranding> {
  const result = await browserGatewayFetch<{
    id?: string;
    tenantId?: string;
    revision: number;
    tokens: BrandingTokens;
    publishedAt: string;
    publishedBy: string;
  }>(BRANDING_API_ENDPOINTS.ACTIVE, {
    method: 'PATCH',
    json: payload,
  });
  return {
    tokens: result.tokens,
    revision: result.revision,
    publishedAt: result.publishedAt,
    publishedBy: result.publishedBy,
  };
}

// Re-export the shared error class so callers don't need to know it
// lives in the browser-gateway module.
export { BrowserGatewayError as BrandingApiError } from '@/lib/api/browser-gateway';
