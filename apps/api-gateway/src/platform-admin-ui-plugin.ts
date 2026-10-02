/**
 * Platform Admin Console — live gateway aggregates (prefer over client stubs).
 *
 * Serves `/api/v1` shapes expected by apps/admin-console API clients:
 *   GET/POST /tenants, GET /tenants/:id, POST lifecycle
 *   GET /plugins, GET /plugins/:id, POST decision
 *   GET/POST /break-glass, GET /break-glass/:id, POST approve/deny/revoke (PRC-H003)
 *   GET /plans, GET /themes
 *   GET /platform/health, GET /platform/audit
 */
import { randomUUID } from 'node:crypto';

import type { TenantService } from '@proctira/backend-tenant';
import { AppError } from '@proctira/common';
import { getSharedPgPool } from '@proctira/database';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import {
  applyExpiry,
  approveRequest,
  createKeyedLock,
  createRequest,
  denyRequest,
  revokeRequest,
  type BreakGlassActor,
  type BreakGlassRow,
  type PolicyResult,
} from './break-glass-policy.js';
import {
  probePostgres,
  queryPlatformAudit,
  toConsoleTenant,
  type ConsoleAuditEntry,
  type SqlPool,
} from './platform-admin-live.js';
import { createPlatformAdminStores } from './platform-admin-store.js';

/** Tenant status as understood by the tenant service (differs from the console labels). */
type ServiceTenantStatus = NonNullable<Parameters<TenantService['listTenants']>[0]['status']>;

type TenantStatus = 'provisioning' | 'active' | 'suspended' | 'decommissioning' | 'archived';

interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  plan: string;
  region: string;
  createdAt: string;
  contactEmail: string;
  activeUsers: number;
  entitlements: string[];
}

interface PluginSubmission {
  id: string;
  name: string;
  vendor: string;
  version: string;
  status: 'submitted' | 'in_review' | 'approved' | 'revoked' | 'disabled';
  submittedAt: string;
  category: string;
  description: string;
  permissions: string[];
  manifestHash: string;
}

type BreakGlassRequest = BreakGlassRow;

function seedTenants(): Tenant[] {
  return [
    {
      id: 'tnt_001',
      slug: 'ministry-edu',
      name: 'Ministry of Education',
      status: 'active',
      plan: 'enterprise',
      region: 'us-east-1',
      createdAt: '2024-01-15T08:00:00Z',
      contactEmail: 'admin@ministry-edu.gov',
      activeUsers: 12450,
      entitlements: ['core', 'analytics', 'sis', 'lms', 'finance'],
    },
    {
      id: 'tnt_002',
      slug: 'district-northwest',
      name: 'Northwest School District',
      status: 'active',
      plan: 'standard',
      region: 'us-west-2',
      createdAt: '2024-03-22T10:30:00Z',
      contactEmail: 'it@nwsd.edu',
      activeUsers: 3220,
      entitlements: ['core', 'sis', 'lms'],
    },
  ];
}

function seedPlugins(): PluginSubmission[] {
  return [
    {
      id: 'plg_001',
      name: 'Attendance Insights Pro',
      vendor: 'Acme Analytics',
      version: '2.1.0',
      status: 'in_review',
      submittedAt: '2025-02-12T11:30:00Z',
      category: 'Analytics',
      description: 'Advanced attendance reporting with predictive risk scoring.',
      permissions: ['students.read', 'attendance.read', 'reports.write'],
      manifestHash: 'sha256:abc123...',
    },
    {
      id: 'plg_002',
      name: 'Parent Portal Lite',
      vendor: 'EduConnect',
      version: '1.4.2',
      status: 'approved',
      submittedAt: '2025-01-08T16:00:00Z',
      category: 'Communication',
      description: 'Lightweight parent-facing portal with messaging support.',
      permissions: ['students.read', 'messages.write'],
      manifestHash: 'sha256:def456...',
    },
  ];
}

function seedBreakGlass(): BreakGlassRequest[] {
  return [
    {
      id: 'bg_001',
      requester: 'engineer1@proctira.org',
      targetTenantId: 'tnt_002',
      scope: 'read',
      justification:
        'Customer reports that grade reports are not exporting. Need to inspect failed job logs.',
      useCase: 'Production incident triage',
      durationMinutes: 60,
      status: 'pending_approval',
      createdAt: '2025-02-25T10:30:00Z',
    },
  ];
}

/** Role IDs that may access the platform admin console (G-104). */
const PLATFORM_ADMIN_ROLE_IDS = new Set(['platform_admin', 'super-admin']);

function roleIdOf(role: unknown): string | undefined {
  if (typeof role === 'string') return role;
  if (role && typeof role === 'object' && 'roleId' in role) {
    const id = (role as { roleId?: unknown }).roleId;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}

export const platformAdminUiPlugin = fp(
  async function platformAdminUiPluginImpl(fastify: FastifyInstance) {
    // G-704: durable console state (Postgres when DATABASE_URL is set); demo
    // rows only when the seed policy allows (G-705).
    const stores = await createPlatformAdminStores<Tenant, PluginSubmission, BreakGlassRequest>({
      tenants: seedTenants,
      plugins: seedPlugins,
      breakGlass: seedBreakGlass,
    });
    const { tenants, plugins, breakGlass } = stores;
    fastify.log.info({ persistence: stores.persistence }, 'platform-admin console store ready');

    // G-104: require platform_admin (or DEFAULT_ROLES super-admin) for all console routes
    fastify.addHook('preHandler', async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.status(401).send({
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          statusCode: 401,
        });
      }

      const roles = user.roles ?? [];
      const allowed = roles.some((r) => {
        const id = roleIdOf(r);
        return id !== undefined && PLATFORM_ADMIN_ROLE_IDS.has(id);
      });

      if (!allowed) {
        return reply.status(403).send({
          code: 'FORBIDDEN',
          message: 'Platform administrator role required',
          statusCode: 403,
        });
      }
    });

    // PRC-H005: console tenant routes read and change the real tenant lifecycle (TenantService,
    // registered at /api/v1/tenant-lifecycle) instead of a console-only document store. The
    // document store remains only when no tenant service is registered (isolated plugin tests).
    const tenantService: TenantService | null = fastify.hasDecorator('tenantService')
      ? (fastify as FastifyInstance & { tenantService: TenantService }).tenantService
      : null;
    const sendDomainError = (reply: FastifyReply, error: unknown) => {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send(error.toJSON());
      }
      throw error;
    };
    /** Same rule as the /tenant-lifecycle schemas: a 1–500 char reason is mandatory. */
    const reasonOf = (request: FastifyRequest): string | null => {
      const reason = (request.body as { reason?: unknown } | undefined)?.reason;
      if (typeof reason !== 'string') return null;
      const trimmed = reason.trim();
      return trimmed.length >= 1 && trimmed.length <= 500 ? trimmed : null;
    };
    const retainDaysOf = (request: FastifyRequest): number | undefined => {
      const value = (request.body as { retainDataDays?: unknown } | undefined)?.retainDataDays;
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 365
        ? value
        : undefined;
    };

    fastify.get('/tenants', async (request, reply) => {
      const query = request.query as { status?: string; q?: string };
      if (tenantService) {
        const status =
          query.status && query.status !== 'all'
            ? query.status === 'decommissioning' || query.status === 'archived'
              ? 'decommissioned'
              : query.status
            : undefined;
        const result = await tenantService.listTenants(
          {
            ...(status ? { status: status as ServiceTenantStatus } : {}),
            ...(query.q ? { search: query.q } : {}),
          },
          { page: 1, pageSize: 200 },
        );
        const items = result.data.map(toConsoleTenant);
        return reply.send({ items, data: items, meta: { source: 'tenant-service' } });
      }
      let items = await tenants.list();
      if (query.status && query.status !== 'all') {
        items = items.filter((t) => t.status === query.status);
      }
      if (query.q) {
        const q = query.q.toLowerCase();
        items = items.filter(
          (t) => t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q),
        );
      }
      return reply.send({ items, data: items, meta: { source: 'console-document' } });
    });

    fastify.get<{ Params: { id: string } }>('/tenants/:id', async (request, reply) => {
      if (tenantService) {
        try {
          return reply.send(toConsoleTenant(await tenantService.getTenantById(request.params.id)));
        } catch (error) {
          return sendDomainError(reply, error);
        }
      }
      const tenant = await tenants.get(request.params.id);
      if (!tenant) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Tenant not found',
          statusCode: 404,
        });
      }
      return reply.send(tenant);
    });

    fastify.post('/tenants', async (request, reply) => {
      if (tenantService) {
        // Real provisioning needs an initial admin user (CreateTenantSchema.admin), which the
        // console form does not collect; see PRC-H099. Refuse rather than create a partial tenant.
        return reply.status(501).send({
          code: 'NOT_IMPLEMENTED',
          message:
            'Tenant provisioning from the console is not wired to the tenant service yet. Use POST /api/v1/tenant-lifecycle with an initial admin user.',
          statusCode: 501,
        });
      }
      const body = (request.body ?? {}) as Partial<Tenant>;
      if (!body.name || !body.slug || !body.contactEmail || !body.plan || !body.region) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'name, slug, contactEmail, plan, and region are required',
          statusCode: 400,
        });
      }
      const tenant: Tenant = {
        id: `tnt_${randomUUID().slice(0, 8)}`,
        slug: body.slug,
        name: body.name,
        status: 'provisioning',
        plan: body.plan,
        region: body.region,
        createdAt: new Date().toISOString(),
        contactEmail: body.contactEmail,
        activeUsers: 0,
        entitlements: ['core'],
      };
      await tenants.set(tenant);
      return reply.status(201).send(tenant);
    });

    for (const action of ['suspend', 'reactivate', 'decommission'] as const) {
      fastify.post<{ Params: { id: string } }>(`/tenants/:id/${action}`, async (request, reply) => {
        if (tenantService) {
          const reason = reasonOf(request);
          if (action !== 'reactivate' && !reason) {
            return reply.status(400).send({
              code: 'VALIDATION_ERROR',
              message: 'reason (1–500 characters) is required',
              statusCode: 400,
            });
          }
          try {
            const id = request.params.id;
            const updated =
              action === 'suspend'
                ? await tenantService.suspendTenant(id, { reason: reason! })
                : action === 'reactivate'
                  ? await tenantService.reactivateTenant(id)
                  : await tenantService.decommissionTenant(id, {
                      reason: reason!,
                      retainDataDays: retainDaysOf(request),
                    });
            return reply.send(toConsoleTenant(updated));
          } catch (error) {
            return sendDomainError(reply, error);
          }
        }
        const tenant = await tenants.get(request.params.id);
        if (!tenant) {
          return reply.status(404).send({
            code: 'NOT_FOUND',
            message: 'Tenant not found',
            statusCode: 404,
          });
        }
        const next: TenantStatus =
          action === 'suspend'
            ? 'suspended'
            : action === 'reactivate'
              ? 'active'
              : 'decommissioning';
        const updated = { ...tenant, status: next };
        await tenants.set(updated);
        return reply.send(updated);
      });
    }

    fastify.delete<{ Params: { id: string } }>('/tenants/:id', async (request, reply) => {
      if (tenantService) {
        // Irreversible permanent delete is not exposed from the console until it collects an
        // explicit confirmation and writes an audit trail; decommission is the console action.
        return reply.status(501).send({
          code: 'NOT_IMPLEMENTED',
          message:
            'Permanent tenant deletion is not available from the console. Decommission the tenant; deletion after retention is an operator runbook step.',
          statusCode: 501,
        });
      }
      const tenant = await tenants.get(request.params.id);
      if (!tenant) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Tenant not found',
          statusCode: 404,
        });
      }
      const updated = { ...tenant, status: 'archived' as const };
      await tenants.set(updated);
      return reply.send(updated);
    });

    fastify.get('/plugins', async (_request, reply) => {
      const items = await plugins.list();
      return reply.send({ items, data: items });
    });

    fastify.get<{ Params: { id: string } }>('/plugins/:id', async (request, reply) => {
      const plugin = await plugins.get(request.params.id);
      if (!plugin) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Plugin not found',
          statusCode: 404,
        });
      }
      return reply.send(plugin);
    });

    for (const action of ['approve', 'revoke', 'disable', 'reject'] as const) {
      fastify.post<{ Params: { id: string } }>(`/plugins/:id/${action}`, async (request, reply) => {
        const plugin = await plugins.get(request.params.id);
        if (!plugin) {
          return reply.status(404).send({
            code: 'NOT_FOUND',
            message: 'Plugin not found',
            statusCode: 404,
          });
        }
        const body = (request.body ?? {}) as { reason?: string };
        if (!body.reason || body.reason.trim().length < 12) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'reason must be at least 12 characters',
            statusCode: 400,
          });
        }
        const status =
          action === 'approve' ? 'approved' : action === 'disable' ? 'disabled' : 'revoked';
        const updated = { ...plugin, status: status as PluginSubmission['status'] };
        await plugins.set(updated);
        return reply.send(updated);
      });
    }

    // PRC-H003: break-glass dual control is enforced here (not only in the console). Identity
    // comes from the verified JWT; see break-glass-policy.ts for the rules.
    const now = () => new Date();
    const actorOf = (request: FastifyRequest): BreakGlassActor | null => {
      const user = request.user as { sub?: unknown; email?: unknown } | undefined;
      const sub = typeof user?.sub === 'string' ? user.sub.trim() : '';
      if (!sub) return null;
      return { sub, email: typeof user?.email === 'string' ? user.email : undefined };
    };
    const sendPolicyError = (reply: FastifyReply, result: Extract<PolicyResult, { ok: false }>) =>
      reply
        .status(result.statusCode)
        .send({ code: result.code, message: result.message, statusCode: result.statusCode });
    const noActor = (reply: FastifyReply) =>
      reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'A verified operator identity is required',
        statusCode: 401,
      });
    const notFound = (reply: FastifyReply) =>
      reply.status(404).send({
        code: 'NOT_FOUND',
        message: 'Break-glass request not found',
        statusCode: 404,
      });

    /**
     * Serialize every break-glass write per request id so read-check-write decisions cannot
     * interleave (e.g. an approve racing a deny, or a read-triggered expiry clobbering a revoke).
     * The keyed store has no compare-and-set; this closes the race within one gateway process.
     * Multi-replica deployments still need a conditional update in the document store
     * (tracked with PRC-H116, PgDocumentCollection).
     */
    const withLock = createKeyedLock();

    /** Persist lazy expiry, re-reading under the lock so a concurrent decision is never overwritten. */
    const persistExpiry = (id: string) =>
      withLock(id, async () => {
        const fresh = await breakGlass.get(id);
        if (!fresh) return null;
        const current = applyExpiry(fresh, now());
        if (current.status !== fresh.status) await breakGlass.set(current);
        return current;
      });

    const loadRow = async (id: string): Promise<BreakGlassRow | null> => {
      const row = await breakGlass.get(id);
      if (!row) return null;
      const current = applyExpiry(row, now());
      return current.status === row.status ? row : persistExpiry(id);
    };
    const listRows = async (): Promise<BreakGlassRow[]> => {
      const rows = await breakGlass.list();
      const out: BreakGlassRow[] = [];
      for (const row of rows) {
        const current = applyExpiry(row, now());
        out.push(current.status === row.status ? row : ((await persistExpiry(row.id)) ?? current));
      }
      return out;
    };

    /** Read → decide → write for one request, serialized per id. */
    const decide = (
      reply: FastifyReply,
      id: string,
      policy: (row: BreakGlassRow) => PolicyResult,
    ) =>
      withLock(id, async () => {
        const stored = await breakGlass.get(id);
        if (!stored) return notFound(reply);
        const current = applyExpiry(stored, now());
        if (current.status !== stored.status) await breakGlass.set(current);
        const result = policy(current);
        if (!result.ok) return sendPolicyError(reply, result);
        await breakGlass.set(result.row);
        return reply.send(result.row);
      });

    fastify.get('/break-glass', async (_request, reply) => {
      const items = await listRows();
      return reply.send({ items, data: items });
    });

    fastify.get('/break-glass/requests', async (_request, reply) => {
      const items = await listRows();
      return reply.send({ items, data: items });
    });

    fastify.get<{ Params: { id: string } }>('/break-glass/:id', async (request, reply) => {
      const row = await loadRow(request.params.id);
      if (!row) return notFound(reply);
      return reply.send(row);
    });

    fastify.post('/break-glass', async (request, reply) => {
      const actor = actorOf(request);
      if (!actor) return noActor(reply);
      const result = createRequest(
        (request.body ?? {}) as Record<string, unknown>,
        actor,
        now(),
        `bg_${randomUUID().slice(0, 8)}`,
      );
      if (!result.ok) return sendPolicyError(reply, result);
      await breakGlass.set(result.row);
      return reply.status(201).send(result.row);
    });

    const decisionReason = (request: FastifyRequest): string | undefined => {
      const reason = (request.body as { reason?: unknown } | undefined)?.reason;
      return typeof reason === 'string' && reason.trim() ? reason.trim() : undefined;
    };

    fastify.post<{ Params: { id: string } }>('/break-glass/:id/approve', async (request, reply) => {
      const actor = actorOf(request);
      if (!actor) return noActor(reply);
      return decide(reply, request.params.id, (row) => approveRequest(row, actor, now()));
    });

    fastify.post<{ Params: { id: string } }>('/break-glass/:id/deny', async (request, reply) => {
      const actor = actorOf(request);
      if (!actor) return noActor(reply);
      return decide(reply, request.params.id, (row) =>
        denyRequest(row, actor, now(), decisionReason(request)),
      );
    });

    fastify.post<{ Params: { id: string } }>('/break-glass/:id/revoke', async (request, reply) => {
      const actor = actorOf(request);
      if (!actor) return noActor(reply);
      return decide(reply, request.params.id, (row) =>
        revokeRequest(row, actor, now(), decisionReason(request)),
      );
    });

    fastify.get('/plans', async (_request, reply) => {
      // PRC-H005: not backed by billing yet — labelled as scaffold data, not live plans.
      return reply.send({
        items: [
          { id: 'plan_enterprise', name: 'Enterprise', priceMonthly: null },
          { id: 'plan_standard', name: 'Standard', priceMonthly: null },
        ],
        meta: { source: 'scaffold' },
      });
    });

    fastify.get('/themes', async (_request, reply) => {
      return reply.send({
        items: [{ id: 'theme_default', name: 'Default', status: 'published' }],
        meta: { source: 'scaffold' },
      });
    });

    // PRC-H005: health comes from real probes; nothing is reported healthy without a check.
    fastify.get('/health/system', async (_request, reply) => {
      const postgres = await probePostgres(getSharedPgPool() as SqlPool | null);
      return reply.send({
        generatedAt: new Date().toISOString(),
        adapters: [
          postgres,
          {
            name: 'API Gateway',
            category: 'external',
            status: 'healthy',
            latencyMs: 0,
            note: 'Serving this request',
            lastChecked: new Date().toISOString(),
          },
        ],
        queues: [],
        errors: postgres.status === 'down' ? [postgres.note] : [],
        meta: { source: 'probe' },
      });
    });

    fastify.get('/platform/health', async (_request, reply) => {
      const postgres = await probePostgres(getSharedPgPool() as SqlPool | null);
      const up = (status: string) => (status === 'healthy' ? 'up' : status);
      return reply.send({
        // Only 'ok' when every dependency was actually verified.
        status:
          postgres.status === 'healthy'
            ? 'ok'
            : postgres.status === 'down'
              ? 'degraded'
              : 'unknown',
        services: [
          { name: 'gateway', status: 'up' },
          { name: 'postgres', status: up(postgres.status), note: postgres.note },
        ],
        source: 'probe',
      });
    });

    // PRC-H005: the audit feed shows only rows present in audit_log_entries.
    const readAudit = async () => {
      const pool = getSharedPgPool() as SqlPool | null;
      if (!pool) return { items: [] as ConsoleAuditEntry[], source: 'unavailable' as const };
      return { items: await queryPlatformAudit(pool), source: 'audit_log_entries' as const };
    };

    fastify.get('/audit', async (_request, reply) => {
      const { items, source } = await readAudit();
      return reply.send({ items, data: items, meta: { source } });
    });

    fastify.get('/platform/audit', async (_request, reply) => {
      const { items, source } = await readAudit();
      return reply.send({
        items: items.map((entry) => ({
          id: entry.id,
          action: entry.action,
          actor: entry.actor,
          at: entry.timestamp,
        })),
        meta: { source },
      });
    });
  },
  { name: 'platform-admin-ui-aggregates', fastify: '5.x' },
);
