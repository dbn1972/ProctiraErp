/**
 * Tenant Branding Routes (Tasks 58.2 + 58.3)
 *
 * Mounts under the gateway at `/api/v1/tenant/branding`. The tenant context
 * comes from the request — the gateway resolves the active tenant from the
 * subdomain / JWT and decorates `request.tenantId` before these handlers
 * run. For test harnesses the tenant id is supplied via the
 * `getTenantId()` resolver passed in `BrandingRoutesOptions`.
 *
 * Endpoints (Task 58.2):
 *
 *   POST   /tenant/branding/publish      Publish a new revision (`tokens` +
 *                                        `publishedBy`). Appends a
 *                                        `tenant_theme_versions` row at
 *                                        `MAX(revision) + 1` and mirrors
 *                                        the tokens onto
 *                                        `tenant_settings.theme`.
 *
 *   POST   /tenant/branding/rollback     Roll back to a prior revision.
 *
 *   GET    /tenant/branding/versions     List every revision recorded for
 *                                        the active tenant.
 *
 *   GET    /tenant/branding              Read the currently active tokens +
 *                                        revision (published only).
 *
 * Endpoints (Task 58.3 — preview cookie/header path):
 *
 *   POST   /tenant/branding/draft        Save (upsert) the in-progress
 *                                        branding draft for the tenant.
 *                                        Caller must have `branding:edit`.
 *
 *   DELETE /tenant/branding/draft        Discard the draft.
 *
 *   GET    /tenant/branding/draft        Read the draft (returns `null`
 *                                        when none is saved).
 *
 *   GET    /tenant/branding/active       Resolve the tokens to render for
 *                                        this request:
 *                                          - If the request carries the
 *                                            `Tenant-Theme-Preview` cookie
 *                                            OR `X-Tenant-Theme-Preview`
 *                                            header AND the caller has the
 *                                            `branding:preview` permission,
 *                                            return the draft tokens with
 *                                            `source: 'draft'`.
 *                                          - Otherwise return the published
 *                                            tokens with
 *                                            `source: 'published'`.
 *
 * Design references:
 *   - Design §N (Tenant Theme Override Pipeline)
 *   - Requirement 28 AC 4 (versioned revisions and rollback)
 *   - Requirement 28 AC 5 (preview before publishing)
 *   - tasks.md 58.2, 58.3
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import {
  PublishBrandingSchema,
  RollbackBrandingSchema,
  SaveBrandingDraftSchema,
  type PublishBrandingInput,
  type RollbackBrandingInput,
  type SaveBrandingDraftInput,
} from './schemas.js';
import type { TenantService } from './tenant-service.js';

/**
 * Resolve the active tenant id from a request. The gateway typically
 * decorates `request.tenantId` from the host header / JWT, but tests can
 * supply any resolver.
 */
export type TenantIdResolver = (request: FastifyRequest) => string | undefined;

/**
 * Default resolver: read `request.tenantId` (set by the gateway plugin).
 */
const defaultTenantIdResolver: TenantIdResolver = (request) =>
  (request as FastifyRequest & { tenantId?: string }).tenantId;

/**
 * The minimal shape of an authenticated permission carrier as seen by the
 * branding routes. The auth plugin decorates the request with a richer
 * payload (`request.user` from `@proctira/auth`), but for this module we
 * only need to ask "does the caller have permission `X`?".
 *
 * Production deployments wire `hasPermission` to the RBAC registry +
 * area-scope evaluator. Tests can pass a synchronous predicate.
 */
export type BrandingPermissionResolver = (
  request: FastifyRequest,
  permission: string,
) => boolean | Promise<boolean>;

/**
 * Cookie name and header name that signal "render the draft tokens, not
 * the published ones" (Design §N). The gateway honors them only after the
 * `branding:preview` permission check passes.
 */
export const PREVIEW_COOKIE_NAME = 'Tenant-Theme-Preview';
export const PREVIEW_HEADER_NAME = 'x-tenant-theme-preview';

/**
 * Default permission resolver: ALWAYS rejects. Production deployments must
 * wire a real resolver via `BrandingRoutesOptions.hasPermission`. The
 * fail-closed default guarantees that forgetting to wire the resolver
 * cannot accidentally hand a draft to anonymous traffic.
 */
const defaultPermissionResolver: BrandingPermissionResolver = () => false;

/**
 * Read the preview signal off a request. Returns `true` if either the
 * `Tenant-Theme-Preview` cookie or the `X-Tenant-Theme-Preview` header is
 * present with a non-empty value. The actual draft tokens are looked up
 * server-side from the tenant's saved draft — the cookie/header is only a
 * boolean opt-in flag (any non-empty value counts).
 *
 * `@fastify/cookie` is NOT a hard dependency of this package. When the
 * gateway has registered the cookie plugin, `request.cookies` is already
 * populated; otherwise we fall back to parsing the `Cookie` header
 * ourselves so that this module remains drop-in usable in tests and minor
 * deployments alike.
 */
function hasPreviewSignal(request: FastifyRequest): boolean {
  const headerValue = (request.headers[PREVIEW_HEADER_NAME] ??
    request.headers[PREVIEW_HEADER_NAME.toLowerCase()]) as string | undefined;
  if (typeof headerValue === 'string' && headerValue.trim().length > 0) {
    return true;
  }

  const cookieJar = (request as FastifyRequest & {
    cookies?: Record<string, string | undefined>;
  }).cookies;
  if (cookieJar && cookieJar[PREVIEW_COOKIE_NAME]?.length) {
    return true;
  }

  // Fallback: parse the raw `Cookie` header. Cookie names are
  // case-sensitive per RFC 6265 §4.1.1; we therefore look up the exact
  // canonical name. We deliberately do not URL-decode the value — its
  // mere presence is the signal.
  const rawCookie = request.headers.cookie;
  if (typeof rawCookie === 'string' && rawCookie.length > 0) {
    const target = `${PREVIEW_COOKIE_NAME}=`;
    for (const segment of rawCookie.split(';')) {
      const trimmed = segment.trimStart();
      if (trimmed.startsWith(target)) {
        const value = trimmed.slice(target.length);
        if (value.trim().length > 0) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Options for registering branding routes.
 */
export interface BrandingRoutesOptions {
  tenantService: TenantService;
  /**
   * Route prefix (default: `/tenant/branding`). The gateway typically
   * mounts everything under `/api/v1` so the absolute path is
   * `/api/v1/tenant/branding/...`.
   */
  prefix?: string;
  /** Override tenant-id resolution for tests. */
  getTenantId?: TenantIdResolver;
  /**
   * Permission resolver invoked for the preview path AND for draft
   * mutating endpoints (Task 58.3). When omitted, all preview signals are
   * ignored and draft endpoints reject every request — this fail-closed
   * default protects deployments that forget to wire the resolver.
   */
  hasPermission?: BrandingPermissionResolver;
}

function tenantRequired(reply: FastifyReply): FastifyReply {
  return reply.status(400).send({
    code: 'TENANT_REQUIRED',
    message: 'Tenant context is required',
    statusCode: 400,
  });
}

function forbidden(reply: FastifyReply, permission: string): FastifyReply {
  return reply.status(403).send({
    code: 'FORBIDDEN',
    message: `Missing required permission '${permission}'`,
    statusCode: 403,
  });
}

/**
 * Register the branding endpoints on a Fastify instance.
 */
export async function registerBrandingRoutes(
  fastify: FastifyInstance,
  options: BrandingRoutesOptions,
): Promise<void> {
  const {
    tenantService,
    prefix = '/tenant/branding',
    getTenantId = defaultTenantIdResolver,
    hasPermission = defaultPermissionResolver,
  } = options;

  // ─── GET /tenant/branding ───────────────────────────────────────────────

  fastify.get(prefix, async function getActiveBrandingHandler(request, reply) {
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);

    try {
      const active = await tenantService.getActiveBranding(tenantId);
      return reply.status(200).send(active);
    } catch (error: unknown) {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send(error.toJSON());
      }
      throw error;
    }
  });

  // ─── GET /tenant/branding/active (Task 58.3) ───────────────────────────
  //
  // Preview-aware variant of `GET /tenant/branding`. When the request
  // presents the preview cookie/header AND the caller has the
  // `branding:preview` permission, the response carries the saved draft
  // tokens (`source: 'draft'`). Otherwise — anonymous, no permission, or
  // no preview signal — the response carries the published tokens
  // (`source: 'published'`).

  fastify.get(
    `${prefix}/active`,
    async function getActiveBrandingForRequestHandler(request, reply) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);

      const previewSignal = hasPreviewSignal(request);
      let previewAllowed = false;
      if (previewSignal) {
        // Only consult the permission resolver when there's something to
        // gate — saves the auth plugin a JWT decode for the typical
        // anonymous landing-page request.
        previewAllowed = Boolean(await hasPermission(request, 'branding:preview'));
      }

      try {
        const active = await tenantService.resolveActiveBrandingForRequest(
          tenantId,
          previewAllowed,
        );
        return reply
          .status(200)
          .send(tenantService.formatActiveBrandingResponse(active));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── GET /tenant/branding/versions ──────────────────────────────────────

  fastify.get(
    `${prefix}/versions`,
    async function listBrandingVersionsHandler(request, reply) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);

      try {
        const versions = await tenantService.listBrandingVersions(tenantId);
        return reply.status(200).send({
          data: versions.map((v) => tenantService.formatThemeVersionResponse(v)),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── POST /tenant/branding/publish ──────────────────────────────────────

  fastify.post(
    `${prefix}/publish`,
    async function publishBrandingHandler(
      request: FastifyRequest<{ Body: PublishBrandingInput }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);

      const result = validate(PublishBrandingSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      try {
        const version = await tenantService.publishBranding(tenantId, result.data);
        return reply.status(201).send(tenantService.formatThemeVersionResponse(version));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── POST /tenant/branding/rollback ─────────────────────────────────────

  fastify.post(
    `${prefix}/rollback`,
    async function rollbackBrandingHandler(
      request: FastifyRequest<{ Body: RollbackBrandingInput }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);

      const result = validate(RollbackBrandingSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      try {
        const rollback = await tenantService.rollbackBranding(tenantId, result.data);
        return reply.status(201).send(tenantService.formatThemeVersionResponse(rollback));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Branding Draft Endpoints (Task 58.3) ───────────────────────────────

  /**
   * GET /tenant/branding/draft — Read the saved draft (or `null`).
   *
   * Authorization: requires `branding:preview` (the same permission that
   * lets the caller see the draft via the preview cookie/header). Without
   * the permission, the endpoint is invisible — this prevents leaking
   * staged-but-unpublished branding to unauthorized viewers.
   */
  fastify.get(
    `${prefix}/draft`,
    async function getBrandingDraftHandler(request, reply) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);

      const allowed = Boolean(await hasPermission(request, 'branding:preview'));
      if (!allowed) return forbidden(reply, 'branding:preview');

      try {
        const draft = await tenantService.getBrandingDraft(tenantId);
        if (!draft) {
          return reply.status(200).send(null);
        }
        return reply
          .status(200)
          .send(tenantService.formatBrandingDraftResponse(draft));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /tenant/branding/draft — Save (upsert) the draft.
   *
   * Authorization: requires `branding:edit` (the user must be allowed to
   * stage branding changes; that permission is a strict superset of
   * `branding:preview` for the Settings → Branding workflow).
   */
  fastify.post(
    `${prefix}/draft`,
    async function saveBrandingDraftHandler(
      request: FastifyRequest<{ Body: SaveBrandingDraftInput }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);

      const allowed = Boolean(await hasPermission(request, 'branding:edit'));
      if (!allowed) return forbidden(reply, 'branding:edit');

      const result = validate(SaveBrandingDraftSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      try {
        const draft = await tenantService.saveBrandingDraft(tenantId, result.data);
        return reply
          .status(201)
          .send(tenantService.formatBrandingDraftResponse(draft));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * DELETE /tenant/branding/draft — Discard the draft.
   *
   * Authorization: requires `branding:edit`. A 204 is returned whether or
   * not a draft was actually present so the client can call this
   * idempotently from a "Discard" button without inspecting the response.
   */
  fastify.delete(
    `${prefix}/draft`,
    async function discardBrandingDraftHandler(request, reply) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);

      const allowed = Boolean(await hasPermission(request, 'branding:edit'));
      if (!allowed) return forbidden(reply, 'branding:edit');

      try {
        await tenantService.discardBrandingDraft(tenantId);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
