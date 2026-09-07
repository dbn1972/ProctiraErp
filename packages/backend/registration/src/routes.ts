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
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

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
  /** Default tenant ID for public routes (resolved from subdomain in production) */
  defaultTenantId?: string;
}

/**
 * Session store interface for language persistence.
 * Requirement 16.5: Session-persisted language selection.
 */
export interface SessionStore {
  get(sessionId: string): Promise<Record<string, string> | null>;
  set(sessionId: string, data: Record<string, string>): Promise<void>;
}

/**
 * Simple in-memory session store for language preferences.
 */
export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, Record<string, string>>();

  async get(sessionId: string): Promise<Record<string, string> | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async set(sessionId: string, data: Record<string, string>): Promise<void> {
    this.sessions.set(sessionId, data);
  }
}

/**
 * Resolves tenant ID from request context.
 * In production, this comes from subdomain/header. For public routes, uses a default.
 */
function resolveTenantId(request: FastifyRequest, defaultTenantId?: string): string {
  const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
  if (tenantId) return tenantId;

  // Check header
  const headerTenant = request.headers['x-tenant-id'];
  if (typeof headerTenant === 'string' && headerTenant.length > 0) return headerTenant;

  // Use default for public routes
  return defaultTenantId ?? 'default';
}

/**
 * Resolves or creates a session ID from request cookies/headers.
 */
function resolveSessionId(request: FastifyRequest): string {
  // Check for session cookie or header
  const sessionHeader = request.headers['x-session-id'];
  if (typeof sessionHeader === 'string' && sessionHeader.length > 0) return sessionHeader;

  // Generate a simple session ID (in production, use proper session management)
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Register public registration routes on a Fastify instance.
 */
export async function registerRegistrationRoutes(
  fastify: FastifyInstance,
  options: RegistrationRoutesOptions,
): Promise<void> {
  const { registrationService, prefix = '/registrations', defaultTenantId } = options;
  const sessionStore = new InMemorySessionStore();

  /**
   * POST /registrations
   * Submit a new registration application.
   * Requirement 16.1, 16.2, 16.3
   */
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

      const tenantId = resolveTenantId(request, defaultTenantId);

      try {
        const response = await registrationService.submitRegistration(tenantId, result.data);
        return reply.status(201).send(response);
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
        const status = await registrationService.checkStatus(paramsResult.data.trackingNumber, dob);
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
      const tenantId = resolveTenantId(request, defaultTenantId);
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
      const tenantId = resolveTenantId(request, defaultTenantId);
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
   * Get form configuration for an institution.
   * Requirement 16.1: Configurable fields per institution type.
   */
  fastify.get(
    `${prefix}/form-config/:institutionId`,
    async function formConfigHandler(
      request: FastifyRequest<{ Params: { institutionId: string } }>,
      reply: FastifyReply,
    ) {
      const { institutionId } = request.params;

      const config = await registrationService.getFormConfiguration(institutionId);
      if (!config) {
        return reply.status(200).send({ institutionTypeId: '', fields: [] });
      }

      return reply.status(200).send(config);
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

      const sessionId = resolveSessionId(request);
      const existingSession = (await sessionStore.get(sessionId)) ?? {};
      await sessionStore.set(sessionId, { ...existingSession, language: result.data.language });

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
      const sessionId = resolveSessionId(request);
      const session = await sessionStore.get(sessionId);
      const language = session?.language ?? 'en';

      return reply.status(200).send({ language, sessionId });
    },
  );

  // ─── Staff CRM (waitlist + interviews) ───────────────────────────────────

  fastify.get(
    `${prefix}/applications`,
    async function listApplicationsHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = resolveTenantId(request, defaultTenantId);
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

      const tenantId = resolveTenantId(request, defaultTenantId);
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
      const tenantId = resolveTenantId(request, defaultTenantId);
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
      const tenantId = resolveTenantId(request, defaultTenantId);
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
      const tenantId = resolveTenantId(request, defaultTenantId);
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
      const tenantId = resolveTenantId(request, defaultTenantId);
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
