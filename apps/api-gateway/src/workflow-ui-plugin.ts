/**
 * Workflows redesign UI aggregate routes (definitions, instances, approvals).
 *
 * Mounts under `/api/v1` so App Router pages can list/create definitions and
 * act on pending approvals with tenant + RBAC gates.
 */
import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

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
  const header = request.headers['x-tenant-id'];
  if (typeof header === 'string' && header.length > 0) return header;
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

function forTenant<T extends { tenantId: string }>(items: T[], tenantId: string): T[] {
  return items.filter((item) => item.tenantId === tenantId);
}

function stripTenant<T extends { tenantId: string }>(item: T): Omit<T, 'tenantId'> {
  const { tenantId: _tenantId, ...rest } = item;
  return rest;
}

function parseSteps(raw: unknown): UiWorkflowStep[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const steps: UiWorkflowStep[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const entry = raw[i];
    if (!entry || typeof entry !== 'object') return null;
    const name = String((entry as { name?: unknown }).name ?? '').trim();
    const approverRole = String(
      (entry as { approverRole?: unknown }).approverRole ?? '',
    ).trim();
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
}

export const workflowUiPlugin = fp(
  async function workflowUiPluginImpl(
    fastify: FastifyInstance,
    options: WorkflowUiPluginOptions = {},
  ) {
    const seed = options.seed ?? createWorkflowUiSeed();

    fastify.get('/workflows/definitions', async (request, reply) => {
      const tenantId = assertWorkflowAccess(request, reply);
      if (!tenantId) return;
      return reply.send({
        data: forTenant(seed.definitions, tenantId).map(stripTenant),
      });
    });

    fastify.get<{ Params: { id: string } }>(
      '/workflows/definitions/:id',
      async (request, reply) => {
        const tenantId = assertWorkflowAccess(request, reply);
        if (!tenantId) return;
        const definition = forTenant(seed.definitions, tenantId).find(
          (d) => d.id === request.params.id,
        );
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
      seed.definitions.unshift(definition);
      return reply.status(201).send(stripTenant(definition));
    });

    fastify.get('/workflows/instances', async (request, reply) => {
      const tenantId = assertWorkflowAccess(request, reply);
      if (!tenantId) return;
      return reply.send({
        data: forTenant(seed.instances, tenantId).map(stripTenant),
      });
    });

    fastify.get('/workflows/approvals/pending', async (request, reply) => {
      const tenantId = assertWorkflowAccess(request, reply);
      if (!tenantId) return;
      return reply.send({
        data: forTenant(seed.approvals, tenantId).map(stripTenant),
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

      const approvalIndex = seed.approvals.findIndex(
        (a) => a.id === request.params.id && a.tenantId === tenantId,
      );
      if (approvalIndex === -1) {
        return deny(reply, 'NOT_FOUND', 'Pending approval not found', 404);
      }

      const [approval] = seed.approvals.splice(approvalIndex, 1);
      if (!approval) {
        return deny(reply, 'NOT_FOUND', 'Pending approval not found', 404);
      }

      const instance = seed.instances.find(
        (i) => i.id === approval.instanceId && i.tenantId === tenantId,
      );
      if (instance) {
        instance.status = decision;
        instance.currentStep = decision === 'APPROVED' ? 'Completed' : 'Rejected';
      }

      return reply.status(200).send({
        id: approval.id,
        instanceId: approval.instanceId,
        status: decision,
      });
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
  { name: 'workflow-ui-aggregates', fastify: '4.x' },
);
