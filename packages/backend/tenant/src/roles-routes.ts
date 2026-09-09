/**
 * Tenant Roles & Permissions Routes (Task 59.3)
 *
 * Powers the Settings → Roles & Permissions surface (Design §R.3,
 * Requirement 42 AC 4–5). Mounted under the gateway at
 * `/api/v1/tenant`.
 *
 * Endpoints:
 *   GET    /tenant/roles                       List tenant roles
 *   POST   /tenant/roles                       Create a custom tenant role
 *   GET    /tenant/roles/:id                   Get a single role
 *   PATCH  /tenant/roles/:id                   Update role metadata + permissions
 *   PATCH  /tenant/roles/:id/permissions       Replace role permissions
 *   DELETE /tenant/roles/:id                   Delete a custom role (built-ins reject)
 *   GET    /tenant/permissions                 Permission catalog (rows for the matrix)
 *   GET    /tenant/users                       Paginated user list for the assignment grid
 *   PATCH  /tenant/users/:userId/roles         Replace a user's role set
 *
 * On every mutation the route invokes the audit emitter the service holds —
 * which the plugin wires to `@proctira/backend-audit`'s `recordAudit` with
 * `metadata.riskLevel = 'high'` (Requirement 33 AC 4).
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import {
  AssignRolesToUserSchema,
  CreateRoleSchema,
  InviteUserSchema,
  ListUsersQuerySchema,
  RoleParamsSchema,
  SetUserStatusSchema,
  UpdateRolePermissionsSchema,
  UpdateRoleSchema,
  UserParamsSchema,
  type AssignRolesToUserInput,
  type CreateRoleInput,
  type InviteUserInput,
  type ListUsersQuery,
  type RoleParams,
  type SetUserStatusInput,
  type UpdateRoleInput,
  type UpdateRolePermissionsInput,
  type UserParams,
} from './roles-schemas.js';
import type { RolesService } from './roles-service.js';
import type { RoleEntity, UserRecord } from './roles-repository.js';

// ─── Request decoration helpers ───────────────────────────────────────────

export type TenantIdResolver = (request: FastifyRequest) => string | undefined;

const defaultTenantIdResolver: TenantIdResolver = (request) =>
  (request as FastifyRequest & { tenantId?: string }).tenantId;

function tenantRequired(reply: FastifyReply): FastifyReply {
  return reply.status(400).send({
    code: 'TENANT_REQUIRED',
    message: 'Tenant context is required',
    statusCode: 400,
  });
}

// ─── Response shapers ─────────────────────────────────────────────────────

function formatRole(role: RoleEntity) {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    builtIn: role.builtIn,
    permissions: role.permissions.map((p) => ({ ...p })),
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

function formatUser(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    roleIds: [...user.roleIds],
  };
}

// ─── Options ──────────────────────────────────────────────────────────────

export interface RolesRoutesOptions {
  rolesService: RolesService;
  /** Override prefix; default `/tenant`. The gateway mounts `/api/v1` above. */
  prefix?: string;
  /** Override tenant id resolution for tests. */
  getTenantId?: TenantIdResolver;
}

// ─── Plugin ───────────────────────────────────────────────────────────────

export async function registerRolesRoutes(
  fastify: FastifyInstance,
  options: RolesRoutesOptions,
): Promise<void> {
  const { rolesService, prefix = '/tenant', getTenantId = defaultTenantIdResolver } = options;

  // GET /tenant/roles -----------------------------------------------------

  fastify.get(`${prefix}/roles`, async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);

    try {
      const roles = await rolesService.listRoles(tenantId);
      return reply.status(200).send({ data: roles.map(formatRole) });
    } catch (error) {
      return handleError(error, reply);
    }
  });

  // GET /tenant/permissions ----------------------------------------------

  fastify.get(`${prefix}/permissions`, async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);

    try {
      const data = await rolesService.listPermissionCatalog(tenantId);
      return reply.status(200).send({ data });
    } catch (error) {
      return handleError(error, reply);
    }
  });

  // POST /tenant/roles ---------------------------------------------------

  fastify.post(
    `${prefix}/roles`,
    async (request: FastifyRequest<{ Body: CreateRoleInput }>, reply: FastifyReply) => {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);

      const result = validate(CreateRoleSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      try {
        const role = await rolesService.createRole(tenantId, {
          name: result.data.name,
          description: result.data.description ?? null,
          permissions: result.data.permissions,
        });
        return reply.status(201).send(formatRole(role));
      } catch (error) {
        return handleError(error, reply);
      }
    },
  );

  // GET /tenant/roles/:id -------------------------------------------------

  fastify.get(
    `${prefix}/roles/:id`,
    async (request: FastifyRequest<{ Params: RoleParams }>, reply: FastifyReply) => {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);

      const params = validate(RoleParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid role id',
          statusCode: 400,
          errors: params.errors,
        });
      }

      try {
        const role = await rolesService.getRole(tenantId, params.data.id);
        return reply.status(200).send(formatRole(role));
      } catch (error) {
        return handleError(error, reply);
      }
    },
  );

  // PATCH /tenant/roles/:id ----------------------------------------------

  fastify.patch(
    `${prefix}/roles/:id`,
    async (
      request: FastifyRequest<{ Params: RoleParams; Body: UpdateRoleInput }>,
      reply: FastifyReply,
    ) => {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);

      const params = validate(RoleParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid role id',
          statusCode: 400,
          errors: params.errors,
        });
      }

      const body = validate(UpdateRoleSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: body.errors,
        });
      }

      try {
        const role = await rolesService.updateRole(tenantId, params.data.id, body.data);
        return reply.status(200).send(formatRole(role));
      } catch (error) {
        return handleError(error, reply);
      }
    },
  );

  // PATCH /tenant/roles/:id/permissions ----------------------------------

  fastify.patch(
    `${prefix}/roles/:id/permissions`,
    async (
      request: FastifyRequest<{
        Params: RoleParams;
        Body: UpdateRolePermissionsInput;
      }>,
      reply: FastifyReply,
    ) => {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);

      const params = validate(RoleParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid role id',
          statusCode: 400,
          errors: params.errors,
        });
      }

      const body = validate(UpdateRolePermissionsSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: body.errors,
        });
      }

      try {
        const role = await rolesService.updateRolePermissions(
          tenantId,
          params.data.id,
          body.data.permissions,
        );
        return reply.status(200).send(formatRole(role));
      } catch (error) {
        return handleError(error, reply);
      }
    },
  );

  // DELETE /tenant/roles/:id ---------------------------------------------

  fastify.delete(
    `${prefix}/roles/:id`,
    async (request: FastifyRequest<{ Params: RoleParams }>, reply: FastifyReply) => {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);

      const params = validate(RoleParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid role id',
          statusCode: 400,
          errors: params.errors,
        });
      }

      try {
        await rolesService.deleteRole(tenantId, params.data.id);
        return reply.status(204).send();
      } catch (error) {
        return handleError(error, reply);
      }
    },
  );

  // GET /tenant/users ----------------------------------------------------

  fastify.get(
    `${prefix}/users`,
    async (request: FastifyRequest<{ Querystring: ListUsersQuery }>, reply: FastifyReply) => {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);

      const raw = request.query as Record<string, unknown>;
      const coerced = {
        ...raw,
        ...(raw['page'] != null ? { page: Number(raw['page']) } : {}),
        ...(raw['pageSize'] != null ? { pageSize: Number(raw['pageSize']) } : {}),
      };

      const result = validate(ListUsersQuerySchema, coerced);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          statusCode: 400,
          errors: result.errors,
        });
      }

      try {
        const users = await rolesService.listUsers(
          tenantId,
          {
            search: result.data.search,
            roleId: result.data.roleId,
            status: result.data.status,
          },
          {
            page: result.data.page ?? 1,
            pageSize: result.data.pageSize ?? 20,
          },
        );
        return reply.status(200).send({
          data: users.data.map(formatUser),
          meta: users.meta,
        });
      } catch (error) {
        return handleError(error, reply);
      }
    },
  );

  // POST /tenant/users — G-910 invite -------------------------------------

  fastify.post(
    `${prefix}/users`,
    async (request: FastifyRequest<{ Body: InviteUserInput }>, reply: FastifyReply) => {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      const body = validate(InviteUserSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: body.errors,
        });
      }
      try {
        const user = await rolesService.inviteUser(tenantId, body.data);
        return reply.status(201).send(formatUser(user));
      } catch (error) {
        return handleError(error, reply);
      }
    },
  );

  // PATCH /tenant/users/:userId/status — G-910 suspend / reactivate --------

  fastify.patch(
    `${prefix}/users/:userId/status`,
    async (
      request: FastifyRequest<{ Params: UserParams; Body: SetUserStatusInput }>,
      reply: FastifyReply,
    ) => {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(UserParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid user id',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const body = validate(SetUserStatusSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: body.errors,
        });
      }
      try {
        const user = await rolesService.setUserStatus(
          tenantId,
          params.data.userId,
          body.data.status,
        );
        return reply.status(200).send(formatUser(user));
      } catch (error) {
        return handleError(error, reply);
      }
    },
  );

  // PATCH /tenant/users/:userId/roles ------------------------------------

  fastify.patch(
    `${prefix}/users/:userId/roles`,
    async (
      request: FastifyRequest<{
        Params: UserParams;
        Body: AssignRolesToUserInput;
      }>,
      reply: FastifyReply,
    ) => {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);

      const params = validate(UserParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid user id',
          statusCode: 400,
          errors: params.errors,
        });
      }

      const body = validate(AssignRolesToUserSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: body.errors,
        });
      }

      try {
        const user = await rolesService.assignRolesToUser(
          tenantId,
          params.data.userId,
          body.data.roleIds,
        );
        return reply.status(200).send(formatUser(user));
      } catch (error) {
        return handleError(error, reply);
      }
    },
  );
}

function handleError(error: unknown, reply: FastifyReply): FastifyReply {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      ...('errors' in error ? { errors: (error as { errors: unknown }).errors } : {}),
    });
  }
  throw error as Error;
}
