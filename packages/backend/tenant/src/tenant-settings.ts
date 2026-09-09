/**
 * Tenant settings (G-910) — the "Tenant" tab of the admin console.
 *
 * `GET  /tenant/settings` returns the effective settings (defaults merged).
 * `PUT  /tenant/settings` replaces them after TypeBox validation.
 *
 * Stored as one tenant-scoped document per tenant in `control_plane_documents`
 * (RLS on tenant_id) when Postgres is available; in-memory otherwise.
 */
import { AppError } from '@proctira/common';
import { PgDocumentCollection, type PgPoolWithConnect, type PgQueryable } from '@proctira/database';
import { validate } from '@proctira/validation';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export const TenantSettingsSchema = Type.Object({
  displayName: Type.String({ minLength: 1, maxLength: 200 }),
  defaultLocale: Type.String({ pattern: '^[a-z]{2}(-[A-Z]{2})?$' }),
  supportedLocales: Type.Array(Type.String({ pattern: '^[a-z]{2}(-[A-Z]{2})?$' }), {
    minItems: 1,
    maxItems: 20,
  }),
  timezone: Type.String({ minLength: 1, maxLength: 64 }),
  academicYearStartMonth: Type.Integer({ minimum: 1, maximum: 12 }),
  branding: Type.Object({
    primaryColor: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }),
    accentColor: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }),
    logoUrl: Type.Optional(Type.Union([Type.String({ maxLength: 2048 }), Type.Null()])),
  }),
  contact: Type.Object({
    email: Type.Optional(Type.Union([Type.String({ maxLength: 320 }), Type.Null()])),
    phone: Type.Optional(Type.Union([Type.String({ maxLength: 40 }), Type.Null()])),
  }),
});

export type TenantSettings = Static<typeof TenantSettingsSchema>;

export interface TenantSettingsRecord extends TenantSettings {
  tenantId: string;
  updatedAt: string;
  updatedBy: string | null;
}

export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  displayName: 'ProctiraERP',
  defaultLocale: 'en',
  supportedLocales: ['en'],
  timezone: 'UTC',
  academicYearStartMonth: 4,
  branding: { primaryColor: '#1d4ed8', accentColor: '#0ea5e9', logoUrl: null },
  contact: { email: null, phone: null },
};

export interface TenantSettingsStore {
  get(tenantId: string): Promise<TenantSettingsRecord | null>;
  put(record: TenantSettingsRecord): Promise<TenantSettingsRecord>;
}

export class InMemoryTenantSettingsStore implements TenantSettingsStore {
  private readonly records = new Map<string, TenantSettingsRecord>();
  async get(tenantId: string): Promise<TenantSettingsRecord | null> {
    return this.records.get(tenantId) ?? null;
  }
  async put(record: TenantSettingsRecord): Promise<TenantSettingsRecord> {
    this.records.set(record.tenantId, record);
    return record;
  }
}

export class PgTenantSettingsStore implements TenantSettingsStore {
  private readonly docs: PgDocumentCollection<TenantSettingsRecord>;
  constructor(pool: PgPoolWithConnect | PgQueryable) {
    this.docs = new PgDocumentCollection<TenantSettingsRecord>(pool, 'tenant.settings');
  }
  async get(tenantId: string): Promise<TenantSettingsRecord | null> {
    const doc = await this.docs.get(tenantId);
    return doc && doc.tenantId === tenantId ? doc : null;
  }
  async put(record: TenantSettingsRecord): Promise<TenantSettingsRecord> {
    return this.docs.put(record.tenantId, record, record.tenantId);
  }
}

export function effectiveTenantSettings(
  tenantId: string,
  stored: TenantSettingsRecord | null,
): TenantSettingsRecord {
  return (
    stored ?? {
      ...DEFAULT_TENANT_SETTINGS,
      tenantId,
      updatedAt: new Date(0).toISOString(),
      updatedBy: null,
    }
  );
}

export interface TenantSettingsRoutesOptions {
  store: TenantSettingsStore;
  /** Default `/tenant`. */
  prefix?: string;
  getTenantId?: (request: FastifyRequest) => string | undefined;
  getActorId?: (request: FastifyRequest) => string | undefined;
}

export async function registerTenantSettingsRoutes(
  fastify: FastifyInstance,
  options: TenantSettingsRoutesOptions,
): Promise<void> {
  const {
    store,
    prefix = '/tenant',
    getTenantId = (request) => (request as FastifyRequest & { tenantId?: string }).tenantId,
    getActorId = (request) =>
      (request as FastifyRequest & { user?: { sub?: string; userId?: string } }).user?.sub ??
      (request as FastifyRequest & { user?: { userId?: string } }).user?.userId,
  } = options;

  fastify.get(`${prefix}/settings`, async (request, reply: FastifyReply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      return reply
        .status(400)
        .send({ code: 'TENANT_REQUIRED', message: 'Tenant context is required', statusCode: 400 });
    }
    const stored = await store.get(tenantId);
    return reply.status(200).send(effectiveTenantSettings(tenantId, stored));
  });

  fastify.put(`${prefix}/settings`, async (request, reply: FastifyReply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      return reply
        .status(400)
        .send({ code: 'TENANT_REQUIRED', message: 'Tenant context is required', statusCode: 400 });
    }
    const body = validate(TenantSettingsSchema, request.body);
    if (!body.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: body.errors,
      });
    }
    if (!body.data.supportedLocales.includes(body.data.defaultLocale)) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: [
          {
            field: 'defaultLocale',
            rule: 'member',
            message: 'defaultLocale must be one of supportedLocales',
          },
        ],
      });
    }
    try {
      const saved = await store.put({
        ...body.data,
        tenantId,
        updatedAt: new Date().toISOString(),
        updatedBy: getActorId(request) ?? null,
      });
      return reply.status(200).send(saved);
    } catch (error) {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send(error.toJSON());
      }
      throw error;
    }
  });
}
