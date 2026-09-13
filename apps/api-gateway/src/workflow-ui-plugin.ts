/**
 * Workflows redesign UI aggregate routes (definitions, instances, approvals).
 *
 * Mounts under `/api/v1` so App Router pages can list/create definitions and
 * act on pending approvals with tenant + RBAC gates.
 *
 * Persistence (G-208): when DATABASE_URL is set, uses Postgres-backed
 * workflow-ui store so approvals/definitions/instances survive restart.
 * Otherwise falls back to in-memory UI seed.
 */
import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { createWorkflowUiStore, type WorkflowUiStore } from './workflow-ui-pg-store.js';
import {
  createWorkflowUiSeed,
  type UiWorkflowDefinition,
  type UiWorkflowStep,
  type WorkflowUiSeed,
} from './workflow-ui-seed.js';

/** Roles allowed to manage / approve workflows via redesign UI. */
const WORKFLOW_UI_ROLES = new Set([
  'SUPER_ADMIN',
  'system_admin',
  'SYSTEM_ADMIN',
  'TENANT_ADMIN',
  'tenant_admin',
  'ADMIN',
  'admin',
  'PRINCIPAL',
  'principal',
  'DISTRICT_ADMIN',
  'district_admin',
  'WORKFLOW_ADMIN',
  'workflow_admin',
  'HR_ADMIN',
  'hr_admin',
]);

interface JwtUserLike {
  sub?: string;
  userId?: string;
  email?: string;
  tenantId?: string;
  roles?: Array<{ roleName?: string; roleId?: string } | string>;
}

function extractRoleNames(user: JwtUserLike | undefined): string[] {
  if (!user?.roles) return [];
  return user.roles
    .map((role) => {
      if (typeof role === 'string') return role;
      return role.roleName ?? role.roleId ?? '';
    })
    .filter(Boolean);
}

function hasWorkflowUiAccess(roles: string[]): boolean {
  return roles.some(
    (role) => WORKFLOW_UI_ROLES.has(role) || WORKFLOW_UI_ROLES.has(role.toUpperCase()),
  );
}

function resolveTenantId(request: FastifyRequest): string | null {
  const fromRequest = (request as FastifyRequest & { tenantId?: string }).tenantId;
  if (fromRequest) return fromRequest;
  const user = (request as FastifyRequest & { user?: JwtUserLike }).user;
  return user?.tenantId ?? null;
}

function deny(
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  code: string,
  message: string,
  statusCode = 403,
) {
  return reply.status(statusCode).send({ code, message, statusCode });
}

function assertWorkflowAccess(
  request: FastifyRequest,
  reply: {
    status: (code: number) => { send: (body: unknown) => unknown };
  },
): string | null {
  const user = (request as FastifyRequest & { user?: JwtUserLike }).user;
  if (!hasWorkflowUiAccess(extractRoleNames(user))) {
    deny(reply, 'WORKFLOW_ACCESS_DENIED', 'Not authorized to access workflows');
    return null;
  }
  const tenantId = resolveTenantId(request);
  if (!tenantId) {
    deny(reply, 'TENANT_REQUIRED', 'Tenant context is required', 400);
    return null;
  }
  return tenantId;
}

function stripTenant<T extends { tenantId: string }>(item: T): Omit<T, 'tenantId'> {
  const { tenantId: _tenantId, ...rest } = item;
  return rest;
}

function parseSteps(raw: unknown): UiWorkflowStep[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const entries: unknown[] = raw;
  const steps: UiWorkflowStep[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry: unknown = entries[i];
    if (!entry || typeof entry !== 'object') return null;
    const record = entry as { name?: unknown; approverRole?: unknown };
    const name = String(record.name ?? '').trim();
    const approverRole = String(record.approverRole ?? '').trim();
    if (!name || !approverRole) return null;
    steps.push({
      id: `step-${i + 1}`,
      order: i + 1,
      name,
      approverRole,
    });
  }
  return steps;
}

export interface WorkflowUiPluginOptions {
  seed?: WorkflowUiSeed;
  /** Optional store override (tests). */
  store?: WorkflowUiStore;
  /** Force in-memory seed store even when DATABASE_URL is set (unit tests). */
  forceMemory?: boolean;
}

export const workflowUiPlugin = fp(
  async function workflowUiPluginImpl(
    fastify: FastifyInstance,
    options: WorkflowUiPluginOptions = {},
  ) {
    await Promise.resolve();
    const store =
      options.store ??
      createWorkflowUiStore(options.seed ?? createWorkflowUiSeed(), {
        forceMemory: options.forceMemory,
      });

    fastify.get('/workflows/definitions', async (request, reply) => {
      const tenantId = assertWorkflowAccess(request, reply);
      if (!tenantId) return;
      const definitions = await store.listDefinitions(tenantId);
      return reply.send({
        data: definitions.map(stripTenant),
      });
    });

    fastify.get<{ Params: { id: string } }>(
      '/workflows/definitions/:id',
      async (request, reply) => {
        const tenantId = assertWorkflowAccess(request, reply);
        if (!tenantId) return;
        const definition = await store.getDefinition(tenantId, request.params.id);
        if (!definition) {
          return deny(reply, 'NOT_FOUND', 'Workflow definition not found', 404);
        }
        return reply.send(stripTenant(definition));
      },
    );

    fastify.post<{
      Body: { name?: string; module?: string; steps?: unknown };
    }>('/workflows/definitions', async (request, reply) => {
      const tenantId = assertWorkflowAccess(request, reply);
      if (!tenantId) return;

      const name = String(request.body?.name ?? '').trim();
      const moduleName = String(request.body?.module ?? '').trim();
      const steps = parseSteps(request.body?.steps);
      if (!name || !moduleName || !steps) {
        return deny(
          reply,
          'VALIDATION_ERROR',
          'name, module, and at least one step (name + approverRole) are required',
          400,
        );
      }

      const definition: UiWorkflowDefinition = {
        id: randomUUID(),
        tenantId,
        name,
        module: moduleName,
        version: 1,
        steps,
        active: true,
        updatedAt: new Date().toISOString(),
      };
      const created = await store.createDefinition(definition);
      return reply.status(201).send(stripTenant(created));
    });

    fastify.get('/workflows/instances', async (request, reply) => {
      const tenantId = assertWorkflowAccess(request, reply);
      if (!tenantId) return;
      const instances = await store.listInstances(tenantId);
      return reply.send({
        data: instances.map(stripTenant),
      });
    });

    fastify.get('/workflows/approvals/pending', async (request, reply) => {
      const tenantId = assertWorkflowAccess(request, reply);
      if (!tenantId) return;
      const approvals = await store.listPendingApprovals(tenantId);
      return reply.send({
        data: approvals.map(stripTenant),
      });
    });

    async function decideApproval(
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: {
        status: (code: number) => { send: (body: unknown) => unknown };
      },
      decision: 'APPROVED' | 'REJECTED',
    ) {
      const tenantId = assertWorkflowAccess(request, reply);
      if (!tenantId) return;

      const actorId =
        (request as FastifyRequest & { user?: { sub?: string } }).user?.sub ?? 'workflow-ui';
      const result = await store.decideApproval(tenantId, request.params.id, decision, actorId);
      if (!result) {
        return deny(reply, 'NOT_FOUND', 'Pending approval not found', 404);
      }

      return reply.status(200).send(result);
    }

    fastify.post<{ Params: { id: string } }>(
      '/workflows/approvals/:id/approve',
      async (request, reply) => decideApproval(request, reply, 'APPROVED'),
    );

    fastify.post<{ Params: { id: string } }>(
      '/workflows/approvals/:id/reject',
      async (request, reply) => decideApproval(request, reply, 'REJECTED'),
    );
  },
  { name: 'workflow-ui-aggregates', fastify: '5.x' },
);
