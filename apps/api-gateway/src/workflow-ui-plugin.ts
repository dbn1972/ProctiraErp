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

import {
  createWorkflowUiStore,
  type WorkflowApprovalContext,
  type WorkflowUiPage,
  type WorkflowUiStore,
} from './workflow-ui-pg-store.js';
import {
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

/** PRC-M021: may decide any step (still never their own request). */
const WORKFLOW_PLATFORM_DECIDER_ROLES = new Set([
  'super_admin',
  'platform_admin',
  'system_admin',
]);

function normalizeRole(role: string): string {
  return role.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/** Every role id AND role name the caller holds, normalised. */
function callerRoleKeys(user: JwtUserLike | undefined): Set<string> {
  const keys = new Set<string>();
  for (const role of user?.roles ?? []) {
    if (typeof role === 'string') keys.add(normalizeRole(role));
    else {
      if (role.roleId) keys.add(normalizeRole(role.roleId));
      if (role.roleName) keys.add(normalizeRole(role.roleName));
    }
  }
  return keys;
}

export type ApprovalDecisionCheck =
  | { ok: true }
  | { ok: false; code: 'WORKFLOW_STEP_NOT_ASSIGNED' | 'WORKFLOW_SELF_APPROVAL_FORBIDDEN' };

export function checkApprovalDecider(
  user: JwtUserLike | undefined,
  actorId: string | undefined,
  context: WorkflowApprovalContext,
  options: { allowSelfApproval?: boolean } = {},
): ApprovalDecisionCheck {
  const roles = callerRoleKeys(user);
  const isPlatform = [...roles].some((r) => WORKFLOW_PLATFORM_DECIDER_ROLES.has(r));
  const assigned = context.approverRole ? roles.has(normalizeRole(context.approverRole)) : false;
  if (!assigned && !isPlatform) return { ok: false, code: 'WORKFLOW_STEP_NOT_ASSIGNED' };
  if (!actorId) return { ok: false, code: 'WORKFLOW_STEP_NOT_ASSIGNED' };
  if (!options.allowSelfApproval && context.initiatedBy && context.initiatedBy === actorId) {
    return { ok: false, code: 'WORKFLOW_SELF_APPROVAL_FORBIDDEN' };
  }
  return { ok: true };
}

/** Derive the decision context from list methods for stores without a direct lookup. */
async function resolveApprovalContext(
  store: WorkflowUiStore,
  tenantId: string,
  approvalId: string,
): Promise<WorkflowApprovalContext | null> {
  if (store.getApprovalContext) return store.getApprovalContext(tenantId, approvalId);
  const approval = (await store.listPendingApprovals(tenantId)).find((a) => a.id === approvalId);
  if (!approval) return null;
  const instance = (await store.listInstances(tenantId)).find((i) => i.id === approval.instanceId);
  const definition = instance ? await store.getDefinition(tenantId, instance.definitionId) : null;
  const step = definition?.steps.find((st) => st.name === approval.stepName);
  return {
    approverRole: step?.approverRole ?? null,
    initiatedBy: instance?.initiatedBy ?? null,
  };
}

const MAX_PAGE_SIZE = 200;

function parsePagination(query: unknown): { page: number; pageSize: number } {
  const q = (query ?? {}) as { page?: unknown; pageSize?: unknown };
  const int = (v: unknown, d: number) => {
    const n = Number.parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return { page: int(q.page, 1), pageSize: Math.min(MAX_PAGE_SIZE, int(q.pageSize, MAX_PAGE_SIZE)) };
}

function pageOf<T>(rows: T[], pagination: { page: number; pageSize: number }): WorkflowUiPage<T> {
  const start = (pagination.page - 1) * pagination.pageSize;
  return {
    data: rows.slice(start, start + pagination.pageSize),
    meta: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalItems: rows.length,
      totalPages: Math.max(1, Math.ceil(rows.length / pagination.pageSize)),
    },
  };
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
  /** PRC-M021: allow initiators to approve their own requests. Default false. */
  allowSelfApproval?: boolean;
}

export const workflowUiPlugin = fp(
  async function workflowUiPluginImpl(
    fastify: FastifyInstance,
    options: WorkflowUiPluginOptions = {},
  ) {
    await Promise.resolve();
    const store =
      options.store ??
      createWorkflowUiStore(options.seed, {
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
      const pagination = parsePagination(request.query);
      const page = store.listInstancesPage
        ? await store.listInstancesPage(tenantId, pagination)
        : pageOf(await store.listInstances(tenantId), pagination);
      return reply.send({ data: page.data.map(stripTenant), meta: page.meta });
    });

    fastify.get('/workflows/approvals/pending', async (request, reply) => {
      const tenantId = assertWorkflowAccess(request, reply);
      if (!tenantId) return;
      const pagination = parsePagination(request.query);
      const page = store.listPendingApprovalsPage
        ? await store.listPendingApprovalsPage(tenantId, pagination)
        : pageOf(await store.listPendingApprovals(tenantId), pagination);
      return reply.send({ data: page.data.map(stripTenant), meta: page.meta });
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

      const user = (request as FastifyRequest & { user?: JwtUserLike }).user;
      const actorId = user?.sub ?? user?.userId;
      // PRC-M021: the caller must hold the current step's approver role (or be a
      // platform decider) and must not be the initiator. Unknown / other-tenant → 404.
      const context = await resolveApprovalContext(store, tenantId, request.params.id);
      if (!context) {
        return deny(reply, 'NOT_FOUND', 'Pending approval not found', 404);
      }
      const check = checkApprovalDecider(user, actorId, context, {
        allowSelfApproval: options.allowSelfApproval === true,
      });
      if (!check.ok) {
        request.log.warn(
          {
            audit: 'workflow.approval.denied',
            tenantId,
            approvalId: request.params.id,
            actorId,
            reason: check.code,
            approverRole: context.approverRole,
          },
          'workflow approval decision denied',
        );
        const auditService = (fastify as unknown as {
          auditService?: { recordAudit?: (input: Record<string, unknown>) => Promise<unknown> };
        }).auditService;
        await auditService
          ?.recordAudit?.({
            tenantId,
            entityType: 'workflow_approval',
            entityId: request.params.id,
            operation: 'UPDATE',
            userId: actorId ?? 'unknown',
            userName: user?.email ?? actorId ?? 'unknown',
            ipAddress: request.ip,
            beforeValues: null,
            afterValues: null,
            metadata: { outcome: 'denied', reason: check.code, decision },
          })
          .catch((err: unknown) => request.log.error({ err }, 'workflow denial audit failed'));
        return deny(
          reply,
          check.code,
          check.code === 'WORKFLOW_SELF_APPROVAL_FORBIDDEN'
            ? 'You cannot decide a request you initiated'
            : 'This approval step is not assigned to you',
        );
      }
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
