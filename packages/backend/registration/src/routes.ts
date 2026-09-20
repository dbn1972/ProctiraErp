/**
 * Registration Routes
 *
 * Public-facing routes (no authentication required):
 * POST   /registrations              - Submit a registration application
 * GET    /registrations/:trackingNumber/status - Check application status
 * GET    /registrations/institutions  - Get institution locations for map
 * GET    /registrations/form-config/:institutionId - Get form configuration
 * POST   /registrations/language      - Set language preference (session)
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6
 */
import { createHash, randomBytes } from 'node:crypto';

import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { isPublicRegistrationPath } from './registration-access.js';
import { enforceRegistrationRouteAccess } from './registration-http-guard.js';
import type { RegistrationService } from './registration-service.js';
import {
  SubmitRegistrationSchema,
  TrackingNumberParamsSchema,
  LanguageSelectionSchema,
  SchoolFinderQuerySchema,
  UpdateApplicationStatusSchema,
  ApplicationParamsSchema,
  CreateInterviewSlotSchema,
  BookInterviewSchema,
  type SubmitRegistrationInput,
  type TrackingNumberParams,
  type InstitutionMapQuery,
  type LanguageSelection,
  type UpdateApplicationStatusInput,
  type ApplicationParams,
  type CreateInterviewSlotInput,
  type BookInterviewInput,
} from './schemas.js';

/**
 * Options for registering registration routes.
 */
export interface RegistrationRoutesOptions {
  registrationService: RegistrationService;
  /** Route prefix (default: '/registrations') */
  prefix?: string;
  /** Trusted hostname-to-canonical-tenant resolver for anonymous routes. */
  publicTenantResolver?: PublicTenantResolver;
  /**
   * Explicit non-production fallback used by isolated tests only. Production
   * refuses this option and requires publicTenantResolver.
   */
  defaultTenantId?: string;
  /**
   * W1-SEC-05: shared session store (Redis/DB in multi-replica). Defaults to
   * in-memory only when NODE_ENV !== 'production'.
   */
  sessionStore?: RegistrationSessionStore;
  /** Session TTL ms (default 8h). */
  sessionTtlMs?: number;
}

/** Trusted public host lookup injected by gateway composition. */
export interface PublicTenantResolver {
  resolveHostname(hostHeader: string | undefined): Promise<string | null>;
}

/** W1-SEC-05 session record with binding + expiry. */
export interface RegistrationSessionRecord {
  data: Record<string, string>;
  /** SHA-256 of User-Agent (or explicit client binding). */
  clientBinding: string;
  expiresAtMs: number;
}

/**
 * Session store interface for language persistence.
 * Requirement 16.5 / W1-SEC-05: TTL + binding + shared-store ready.
 */
export interface RegistrationSessionStore {
  get(sessionId: string): Promise<RegistrationSessionRecord | null>;
  set(sessionId: string, record: RegistrationSessionRecord): Promise<void>;
  delete?(sessionId: string): Promise<void>;
}

/** @deprecated Use RegistrationSessionStore */
export type SessionStore = RegistrationSessionStore;

/**
 * Process-local session store (dev/test). Production must inject a shared store.
 */
export class InMemorySessionStore implements RegistrationSessionStore {
  private sessions = new Map<string, RegistrationSessionRecord>();

  async get(sessionId: string): Promise<RegistrationSessionRecord | null> {
    const row = this.sessions.get(sessionId);
    if (!row) return null;
    if (row.expiresAtMs <= Date.now()) {
      this.sessions.delete(sessionId);
      return null;
    }
    return row;
  }

  async set(sessionId: string, record: RegistrationSessionRecord): Promise<void> {
    this.sessions.set(sessionId, record);
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}

/** 128-bit CSPRNG session id (32 hex chars). */
export function mintRegistrationSessionId(): string {
  return randomBytes(16).toString('hex');
}

export function hashClientBinding(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function clientBindingFromRequest(request: FastifyRequest): string {
  const ua = typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : '';
  const explicit =
    typeof request.headers['x-client-binding'] === 'string' ? request.headers['x-client-binding'] : '';
  return hashClientBinding(`${explicit}|${ua}`);
}

/** Public tenant context resolved only from the raw Host header. */
declare module 'fastify' {
  interface FastifyRequest {
    publicRegistrationTenantId?: string;
  }
}

const SUBMISSION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function publicTenantId(request: FastifyRequest): string {
  const tenantId = request.publicRegistrationTenantId;
  if (!tenantId) {
    throw new AppError(
      'Registration portal is unavailable for this request',
      'PUBLIC_REGISTRATION_CONTEXT_NOT_FOUND',
      404,
    );
  }
  return tenantId;
}

function authenticatedTenantId(request: FastifyRequest): string {
  const scopedRequest = request as FastifyRequest & {
    tenantId?: string;
    user?: { tenantId?: string };
  };
  const tenantId = scopedRequest.tenantId ?? scopedRequest.user?.tenantId;
  if (!tenantId) {
    throw new AppError('Authenticated tenant context is required', 'TENANT_CONTEXT_REQUIRED', 401);
  }
  return tenantId;
}

function submissionKeyFromRequest(request: FastifyRequest): string | null {
  const value = request.headers['idempotency-key'];
  return typeof value === 'string' && SUBMISSION_KEY_PATTERN.test(value) ? value : null;
}

const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * W1-SEC-05: never trust a client-minted x-session-id. Only reuse IDs that
 * already exist in the store with matching client binding and unexpired TTL.
 */
async function resolveOrMintSessionId(
  request: FastifyRequest,
  store: RegistrationSessionStore,
  binding: string,
): Promise<{ sessionId: string; existing: RegistrationSessionRecord | null }> {
  const sessionHeader = request.headers['x-session-id'];
  if (typeof sessionHeader === 'string' && /^[a-f0-9]{32}$/i.test(sessionHeader)) {
    const existing = await store.get(sessionHeader);
    if (existing && existing.clientBinding === binding) {
      return { sessionId: sessionHeader, existing };
    }
  }
  return { sessionId: mintRegistrationSessionId(), existing: null };
}

/**
 * Register public registration routes on a Fastify instance.
 */
export async function registerRegistrationRoutes(
  fastify: FastifyInstance,
  options: RegistrationRoutesOptions,
): Promise<void> {
  const {
    registrationService,
    prefix = '/registrations',
    publicTenantResolver,
    defaultTenantId,
  } = options;
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  if (process.env.NODE_ENV === 'production' && defaultTenantId) {
    throw new AppError(
      'Production public registration cannot use defaultTenantId; inject publicTenantResolver',
      'REGISTRATION_CONFIGURATION_ERROR',
      500,
    );
  }
  if (process.env.NODE_ENV === 'production' && !publicTenantResolver) {
    throw new AppError(
      'Production public registration requires an injected publicTenantResolver',
      'REGISTRATION_CONFIGURATION_ERROR',
      500,
    );
  }
  if (process.env.NODE_ENV === 'production' && !options.sessionStore) {
    throw new AppError(
      'Production registration routes require an injected shared session store',
      'REGISTRATION_CONFIGURATION_ERROR',
      500,
    );
  }
  const sessionStore = options.sessionStore ?? new InMemorySessionStore();

  /**
   * POST /registrations
   * Submit a new registration application.
   * Requirement 16.1, 16.2, 16.3
   */

  if (!fastify.hasRequestDecorator('publicRegistrationTenantId')) {
    fastify.decorateRequest('publicRegistrationTenantId', undefined);
  }

  // Public routes resolve tenant exclusively from raw Host through trusted DI.
  // Caller tenant and forwarding headers are deliberately ignored. Staff paths
  // retain the authenticated gateway tenant/RBAC path.
  fastify.addHook('preHandler', async (request, reply) => {
    if (!isPublicRegistrationPath(request.url)) {
      if (!enforceRegistrationRouteAccess(request, reply)) return reply;
      return;
    }

    try {
      const resolved = await publicTenantResolver?.resolveHostname(request.headers.host);
      const explicitTestFallback =
        process.env.NODE_ENV !== 'production' && defaultTenantId ? defaultTenantId : undefined;
      const tenantId = resolved ?? explicitTestFallback;
      if (!tenantId) {
        return reply.status(404).send({
          code: 'PUBLIC_REGISTRATION_CONTEXT_NOT_FOUND',
          message: 'Registration portal is unavailable for this request',
          statusCode: 404,
        });
      }
      request.publicRegistrationTenantId = tenantId;
    } catch {
      return reply.status(503).send({
        code: 'PUBLIC_REGISTRATION_CONTEXT_UNAVAILABLE',
        message: 'Registration portal is temporarily unavailable',
        statusCode: 503,
      });
    }
  });

  fastify.post(
    prefix,
    async function submitHandler(
      request: FastifyRequest<{ Body: SubmitRegistrationInput }>,
      reply: FastifyReply,
    ) {
      // Validate request body
      const result = validate(SubmitRegistrationSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = publicTenantId(request);
      const submissionKey = submissionKeyFromRequest(request);
      if (!submissionKey) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'A valid Idempotency-Key header is required',
          statusCode: 400,
          errors: [
            {
              field: 'idempotencyKey',
              rule: 'required',
              message: 'Provide an 8-128 character Idempotency-Key header',
            },
          ],
        });
      }

      try {
        const { replayed, ...response } = await registrationService.submitRegistration(
          tenantId,
          result.data,
          submissionKey,
        );
        if (replayed) reply.header('x-idempotency-replay', 'true');
        return reply.status(replayed ? 200 : 201).send(response);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /registrations/:trackingNumber/status
   * Check application status by tracking number.
   * Requirement 16.6: No authentication required.
   */
  fastify.get(
    `${prefix}/:trackingNumber/status`,
    async function statusHandler(
      request: FastifyRequest<{ Params: TrackingNumberParams }>,
      reply: FastifyReply,
    ) {
      // Validate params
      const paramsResult = validate(TrackingNumberParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid tracking number format',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const dob =
          typeof (request.query as { dob?: string }).dob === 'string'
            ? (request.query as { dob?: string }).dob
            : undefined;
        const status = await registrationService.checkStatus(
          paramsResult.data.trackingNumber,
          dob,
          publicTenantId(request),
        );
        return reply.status(200).send(status);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /registrations/institutions
   * Get institution locations for map display.
   * Requirement 16.4: Interactive map with area/type/grade filtering.
   */
  fastify.get(
    `${prefix}/institutions`,
    async function institutionsHandler(
      request: FastifyRequest<{ Querystring: InstitutionMapQuery }>,
      reply: FastifyReply,
    ) {
      const tenantId = publicTenantId(request);
      const query = request.query;

      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 50;

      const result = await registrationService.getInstitutionLocations(
        tenantId,
        {
          areaId: query.areaId,
          typeId: query.typeId,
          gradeId: query.gradeId,
          search: query.search,
        },
        { page, pageSize },
      );

      return reply.status(200).send(result);
    },
  );

  /**
   * GET /registrations/schools/search
   * Run a School Finder query.
   *
   * Requirement 16.9: search by geolocation (lat/lon + radius) plus
   * filters by area, type, and grade. Query string carries:
   *
   *   ?latitude=…&longitude=…&radiusKm=…       (optional, all-or-nothing)
   *   &areaIds=a,b&schoolTypes=primary,secondary&gradeLevels=g1,g2
   *   &search=lincoln&page=1&pageSize=20
   *
   * Repeated query keys (`areaIds=a&areaIds=b`) and comma-separated
   * lists are both accepted, mirroring the way browsers serialise
   * multi-select form fields.
   */
  fastify.get(
    `${prefix}/schools/search`,
    async function schoolsSearchHandler(
      request: FastifyRequest<{ Querystring: Record<string, string | string[]> }>,
      reply: FastifyReply,
    ) {
      const tenantId = publicTenantId(request);
      const raw = request.query;

      const parseList = (value: string | string[] | undefined): string[] | undefined => {
        if (value === undefined) return undefined;
        const arr = Array.isArray(value) ? value : [value];
        const flattened = arr
          .flatMap((entry) => entry.split(','))
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        return flattened.length > 0 ? flattened : undefined;
      };

      const parseNumber = (value: string | string[] | undefined): number | undefined => {
        if (value === undefined) return undefined;
        const v = Array.isArray(value) ? value[0] : value;
        if (v === undefined || v === '') return undefined;
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
      };

      const candidate: Record<string, unknown> = {
        ...(parseNumber(raw.latitude) !== undefined ? { latitude: parseNumber(raw.latitude) } : {}),
        ...(parseNumber(raw.longitude) !== undefined
          ? { longitude: parseNumber(raw.longitude) }
          : {}),
        ...(parseNumber(raw.radiusKm) !== undefined ? { radiusKm: parseNumber(raw.radiusKm) } : {}),
        ...(parseList(raw.areaIds) ? { areaIds: parseList(raw.areaIds) } : {}),
        ...(parseList(raw.schoolTypes) ? { schoolTypes: parseList(raw.schoolTypes) } : {}),
        ...(parseList(raw.gradeLevels) ? { gradeLevels: parseList(raw.gradeLevels) } : {}),
        ...(typeof raw.search === 'string' && raw.search.length > 0 ? { search: raw.search } : {}),
        ...(parseNumber(raw.page) !== undefined ? { page: parseNumber(raw.page) } : {}),
        ...(parseNumber(raw.pageSize) !== undefined ? { pageSize: parseNumber(raw.pageSize) } : {}),
      };

      const validation = validate(SchoolFinderQuerySchema, candidate);
      if (!validation.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid School Finder query',
          statusCode: 400,
          errors: validation.errors,
        });
      }

      try {
        const result = await registrationService.searchSchools(tenantId, validation.data);
        return reply.status(200).send(result);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /registrations/form-config/:institutionId
   * Get the latest published configuration for a tenant-owned institution UUID.
   */
  fastify.get(
    `${prefix}/form-config/:institutionId`,
    async function formConfigHandler(
      request: FastifyRequest<{ Params: { institutionId: string } }>,
      reply: FastifyReply,
    ) {
      const { institutionId } = request.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(institutionId)) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'A valid institution UUID is required',
          statusCode: 400,
          errors: [
            { field: 'institutionId', rule: 'uuid', message: 'Select a valid institution' },
          ],
        });
      }

      try {
        const config = await registrationService.getFormConfiguration(
          publicTenantId(request),
          institutionId,
        );
        if (!config) {
          return reply.status(404).send({
            code: 'FORM_CONFIGURATION_NOT_FOUND',
            message: 'No published registration form is available for the selected institution',
            statusCode: 404,
          });
        }
        return reply.status(200).send(config);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /registrations/language
   * Set language preference for the session.
   * Requirement 16.5: Multi-language interface with session-persisted language selection.
   */
  fastify.post(
    `${prefix}/language`,
    async function languageHandler(
      request: FastifyRequest<{ Body: LanguageSelection }>,
      reply: FastifyReply,
    ) {
      const result = validate(LanguageSelectionSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid language selection',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const binding = clientBindingFromRequest(request);
      const { sessionId, existing } = await resolveOrMintSessionId(request, sessionStore, binding);
      const data = { ...(existing?.data ?? {}), language: result.data.language };
      await sessionStore.set(sessionId, {
        data,
        clientBinding: binding,
        expiresAtMs: Date.now() + sessionTtlMs,
      });

      return reply
        .status(200)
        .header('x-session-id', sessionId)
        .send({
          language: result.data.language,
          sessionId,
          message: `Language set to '${result.data.language}'`,
        });
    },
  );

  /**
   * GET /registrations/language
   * Get current language preference from session.
   * Requirement 16.5
   */
  fastify.get(
    `${prefix}/language`,
    async function getLanguageHandler(request: FastifyRequest, reply: FastifyReply) {
      const binding = clientBindingFromRequest(request);
      const { sessionId, existing } = await resolveOrMintSessionId(request, sessionStore, binding);
      const language = existing?.data.language ?? 'en';
      if (!existing) {
        // Mint empty session so client receives a server-issued id (not client-chosen).
        await sessionStore.set(sessionId, {
          data: {},
          clientBinding: binding,
          expiresAtMs: Date.now() + sessionTtlMs,
        });
      }

      return reply.status(200).header('x-session-id', sessionId).send({ language, sessionId });
    },
  );

  // ─── Staff CRM (waitlist + interviews) ───────────────────────────────────

  fastify.get(
    `${prefix}/applications`,
    async function listApplicationsHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = authenticatedTenantId(request);
      const applications = await registrationService.listApplications(tenantId);
      return reply.status(200).send({
        data: applications.map((row) => ({
          id: row.id,
          tenantId: row.tenantId,
          trackingNumber: row.trackingNumber,
          institutionId: row.institutionId,
          institutionName: row.institutionName,
          status: row.status,
          firstName: row.firstName,
          lastName: row.lastName,
          submittedAt: row.submittedAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          remarks: row.remarks,
        })),
      });
    },
  );

  fastify.post(
    `${prefix}/applications/:id/status`,
    async function updateStatusHandler(
      request: FastifyRequest<{ Params: ApplicationParams; Body: UpdateApplicationStatusInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ApplicationParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid application ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }
      const bodyResult = validate(UpdateApplicationStatusSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      const tenantId = authenticatedTenantId(request);
      try {
        const result = await registrationService.updateApplicationStatus(
          tenantId,
          paramsResult.data.id,
          bodyResult.data.status,
          bodyResult.data.remarks,
        );
        return reply.status(200).send({
          application: {
            id: result.application.id,
            status: result.application.status,
            remarks: result.application.remarks,
            updatedAt: result.application.updatedAt.toISOString(),
          },
          waitlistEntry: result.waitlistEntry
            ? {
                id: result.waitlistEntry.id,
                position: result.waitlistEntry.position,
                institutionId: result.waitlistEntry.institutionId,
              }
            : null,
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/waitlist`,
    async function listWaitlistHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = authenticatedTenantId(request);
      const institutionId =
        typeof (request.query as { institutionId?: string }).institutionId === 'string'
          ? (request.query as { institutionId?: string }).institutionId
          : undefined;
      const entries = await registrationService.listWaitlist(tenantId, institutionId);
      return reply.status(200).send({
        data: entries.map((row) => ({
          id: row.id,
          applicationId: row.applicationId,
          institutionId: row.institutionId,
          position: row.position,
          notes: row.notes,
          createdAt: row.createdAt.toISOString(),
        })),
      });
    },
  );

  fastify.get(
    `${prefix}/interview-slots`,
    async function listSlotsHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = authenticatedTenantId(request);
      const institutionId =
        typeof (request.query as { institutionId?: string }).institutionId === 'string'
          ? (request.query as { institutionId?: string }).institutionId
          : undefined;
      const slots = await registrationService.listInterviewSlots(tenantId, institutionId);
      return reply.status(200).send({
        data: slots.map((row) => ({
          id: row.id,
          institutionId: row.institutionId,
          startsAt: row.startsAt.toISOString(),
          endsAt: row.endsAt.toISOString(),
          capacity: row.capacity,
          location: row.location,
          status: row.status,
        })),
      });
    },
  );

  fastify.post(
    `${prefix}/interview-slots`,
    async function createSlotHandler(
      request: FastifyRequest<{ Body: CreateInterviewSlotInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateInterviewSlotSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }
      const tenantId = authenticatedTenantId(request);
      try {
        const slot = await registrationService.createInterviewSlot(tenantId, result.data);
        return reply.status(201).send({
          id: slot.id,
          institutionId: slot.institutionId,
          startsAt: slot.startsAt.toISOString(),
          endsAt: slot.endsAt.toISOString(),
          capacity: slot.capacity,
          location: slot.location,
          status: slot.status,
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.post(
    `${prefix}/interview-bookings`,
    async function bookInterviewHandler(
      request: FastifyRequest<{ Body: BookInterviewInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(BookInterviewSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }
      const tenantId = authenticatedTenantId(request);
      try {
        const booking = await registrationService.bookInterview(tenantId, result.data);
        return reply.status(201).send({
          id: booking.id,
          slotId: booking.slotId,
          applicationId: booking.applicationId,
          status: booking.status,
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
