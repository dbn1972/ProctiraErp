/**
 * G-924 — SCIM 2.0 provisioning (RFC 7643 / 7644) over the tenant directory.
 *
 * Identity providers (Okta, Entra ID, Google) push users and group membership
 * here. Users map onto the G-910 tenant directory (`RolesService` users) and
 * Groups onto tenant roles, so SCIM writes are the same audited mutations the
 * `/admin/users` console performs. Auth is the gateway's JWT + RBAC
 * (`scim` → `user: manage`); a dedicated long-lived SCIM bearer token is the
 * IdP-side configuration of that same credential.
 *
 * Supported:
 *   GET  /scim/v2/ServiceProviderConfig | /ResourceTypes | /Schemas
 *   GET  /scim/v2/Users?filter=userName eq "x"&startIndex&count
 *   GET/POST/PUT/PATCH/DELETE /scim/v2/Users/:id      (DELETE = deactivate)
 *   GET  /scim/v2/Groups  |  GET/PATCH /scim/v2/Groups/:id (members add/remove/replace)
 */
import type { RoleEntity, RolesService, UserRecord } from '@proctira/backend-tenant';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

const SCIM_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCIM_GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const SCIM_LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const SCIM_PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const SCIM_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';
const SCIM_CONTENT_TYPE = 'application/scim+json; charset=utf-8';

export interface ScimPluginOptions {
  rolesService: RolesService;
  /** Default `/scim/v2`. */
  prefix?: string;
}

interface ScimUser {
  schemas: [typeof SCIM_USER];
  id: string;
  externalId?: string;
  userName: string;
  displayName: string;
  name?: { formatted: string };
  emails: Array<{ value: string; primary: true; type: 'work' }>;
  active: boolean;
  groups: Array<{ value: string; display: string; $ref: string }>;
  meta: { resourceType: 'User'; location: string };
}

interface ScimGroup {
  schemas: [typeof SCIM_GROUP];
  id: string;
  displayName: string;
  members: Array<{ value: string; display: string; $ref: string }>;
  meta: { resourceType: 'Group'; location: string };
}

interface PatchOperation {
  op: string;
  path?: string;
  value?: unknown;
}

const tenantOf = (request: FastifyRequest): string | undefined =>
  (request as FastifyRequest & { tenantId?: string }).tenantId;

function scimError(reply: FastifyReply, status: number, detail: string, scimType?: string) {
  return reply
    .code(status)
    .header('content-type', SCIM_CONTENT_TYPE)
    .send({
      schemas: [SCIM_ERROR],
      status: String(status),
      detail,
      ...(scimType ? { scimType } : {}),
    });
}

function send<T>(reply: FastifyReply, status: number, body: T) {
  return reply.code(status).header('content-type', SCIM_CONTENT_TYPE).send(body);
}

/** `userName eq "value"` / `emails.value eq "value"` / `externalId eq "value"` — the filters IdPs send on lookup. */
export function parseEqFilter(
  filter: string | undefined,
): { attribute: string; value: string } | null {
  if (!filter) return null;
  const match = /^\s*([A-Za-z][\w.]*)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(filter);
  if (!match) return null;
  return { attribute: match[1]!.toLowerCase(), value: match[2]!.replace(/\\(.)/g, '$1') };
}

export function toScimUser(user: UserRecord, roles: RoleEntity[], base: string): ScimUser {
  const byId = new Map(roles.map((r) => [r.id, r]));
  return {
    schemas: [SCIM_USER],
    id: user.id,
    userName: user.email,
    displayName: user.displayName,
    name: { formatted: user.displayName },
    emails: [{ value: user.email, primary: true, type: 'work' }],
    active: user.status !== 'SUSPENDED',
    groups: user.roleIds
      .map((rid) => byId.get(rid))
      .filter((r): r is RoleEntity => Boolean(r))
      .map((r) => ({ value: r.id, display: r.name, $ref: `${base}/Groups/${r.id}` })),
    meta: { resourceType: 'User', location: `${base}/Users/${user.id}` },
  };
}

export function toScimGroup(role: RoleEntity, members: UserRecord[], base: string): ScimGroup {
  return {
    schemas: [SCIM_GROUP],
    id: role.id,
    displayName: role.name,
    members: members.map((u) => ({
      value: u.id,
      display: u.displayName,
      $ref: `${base}/Users/${u.id}`,
    })),
    meta: { resourceType: 'Group', location: `${base}/Groups/${role.id}` },
  };
}

/** Resolve `active` from a PATCH body: `replace` on path `active` or a value object `{ active }`. */
export function activeFromPatch(operations: PatchOperation[]): boolean | undefined {
  let active: boolean | undefined;
  for (const op of operations) {
    const kind = op.op.toLowerCase();
    if (kind !== 'replace' && kind !== 'add') continue;
    if (op.path?.toLowerCase() === 'active') {
      active = op.value === true || op.value === 'True' || op.value === 'true';
    } else if (!op.path && op.value && typeof op.value === 'object' && 'active' in op.value) {
      const v = (op.value as { active: unknown }).active;
      active = v === true || v === 'True' || v === 'true';
    }
  }
  return active;
}

function memberIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((m) =>
      m && typeof m === 'object' && 'value' in m ? String((m as { value: unknown }).value) : null,
    )
    .filter((v): v is string => Boolean(v));
}

/** Parse `members[value eq "id"]` from a remove path. */
function memberFromPath(path: string | undefined): string | null {
  if (!path) return null;
  const match = /^members\[\s*value\s+eq\s+"([^"]+)"\s*\]$/i.exec(path.trim());
  return match ? match[1]! : null;
}

async function allUsers(rolesService: RolesService, tenantId: string): Promise<UserRecord[]> {
  const out: UserRecord[] = [];
  let page = 1;
  for (;;) {
    const result = await rolesService.listUsers(tenantId, {}, { page, pageSize: 200 });
    out.push(...result.data);
    if (result.data.length < 200 || out.length >= result.meta.totalItems) break;
    page += 1;
  }
  return out;
}

export const scimPlugin = fp(
  async (fastify: FastifyInstance, options: ScimPluginOptions) => {
    const prefix = options.prefix ?? '/scim/v2';
    const { rolesService } = options;

    // IdPs post `application/scim+json`; Fastify only parses `application/json` by default.
    if (!fastify.hasContentTypeParser('application/scim+json')) {
      fastify.addContentTypeParser(
        'application/scim+json',
        { parseAs: 'string' },
        (_request, body, done) => {
          try {
            done(null, body.length ? JSON.parse(body as string) : {});
          } catch (error) {
            done(error as Error, undefined);
          }
        },
      );
    }
    const baseFor = (request: FastifyRequest) => {
      const proto =
        (request.headers['x-forwarded-proto'] as string | undefined) ?? request.protocol;
      const host = (request.headers['x-forwarded-host'] as string | undefined) ?? request.hostname;
      return `${proto}://${host}${fastify.prefix}${prefix}`;
    };

    // ── Discovery ────────────────────────────────────────────────────────
    fastify.get(`${prefix}/ServiceProviderConfig`, async (request, reply) =>
      send(reply, 200, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
        documentationUri: 'https://docs.proctira.example/scim',
        patch: { supported: true },
        bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
        filter: { supported: true, maxResults: 200 },
        changePassword: { supported: false },
        sort: { supported: false },
        etag: { supported: false },
        authenticationSchemes: [
          {
            type: 'oauthbearertoken',
            name: 'OAuth Bearer Token',
            description: 'Gateway JWT with tenant scope and user:manage permission',
          },
        ],
        meta: {
          resourceType: 'ServiceProviderConfig',
          location: `${baseFor(request)}/ServiceProviderConfig`,
        },
      }),
    );

    fastify.get(`${prefix}/ResourceTypes`, async (request, reply) => {
      const base = baseFor(request);
      return send(reply, 200, {
        schemas: [SCIM_LIST],
        totalResults: 2,
        startIndex: 1,
        itemsPerPage: 2,
        Resources: [
          {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
            id: 'User',
            name: 'User',
            endpoint: '/Users',
            schema: SCIM_USER,
            meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/User` },
          },
          {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
            id: 'Group',
            name: 'Group',
            endpoint: '/Groups',
            schema: SCIM_GROUP,
            meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/Group` },
          },
        ],
      });
    });

    fastify.get(`${prefix}/Schemas`, async (_request, reply) =>
      send(reply, 200, {
        schemas: [SCIM_LIST],
        totalResults: 2,
        startIndex: 1,
        itemsPerPage: 2,
        Resources: [
          {
            id: SCIM_USER,
            name: 'User',
            attributes: [
              { name: 'userName', type: 'string', required: true, uniqueness: 'server' },
              { name: 'displayName', type: 'string', required: false },
              { name: 'active', type: 'boolean', required: false },
              { name: 'emails', type: 'complex', multiValued: true },
            ],
          },
          {
            id: SCIM_GROUP,
            name: 'Group',
            attributes: [
              { name: 'displayName', type: 'string', required: true },
              { name: 'members', type: 'complex', multiValued: true },
            ],
          },
        ],
      }),
    );

    // ── Users ────────────────────────────────────────────────────────────
    fastify.get<{ Querystring: { filter?: string; startIndex?: string; count?: string } }>(
      `${prefix}/Users`,
      async (request, reply) => {
        const tenantId = tenantOf(request);
        if (!tenantId) return scimError(reply, 400, 'Tenant context required');
        const roles = await rolesService.listRoles(tenantId);
        const base = baseFor(request);
        const filter = parseEqFilter(request.query.filter);
        if (request.query.filter && !filter) {
          return scimError(
            reply,
            400,
            'Only `attribute eq "value"` filters are supported',
            'invalidFilter',
          );
        }
        let users = await allUsers(rolesService, tenantId);
        if (filter) {
          const needle = filter.value.toLowerCase();
          users = users.filter((u) => {
            switch (filter.attribute) {
              case 'username':
              case 'emails.value':
              case 'emails':
                return u.email.toLowerCase() === needle;
              case 'externalid':
              case 'id':
                return u.id.toLowerCase() === needle;
              case 'displayname':
                return u.displayName.toLowerCase() === needle;
              default:
                return false;
            }
          });
        }
        const startIndex = Math.max(1, Number(request.query.startIndex ?? 1) || 1);
        const count = Math.min(200, Math.max(0, Number(request.query.count ?? 100) || 100));
        const slice = users.slice(startIndex - 1, startIndex - 1 + count);
        return send(reply, 200, {
          schemas: [SCIM_LIST],
          totalResults: users.length,
          startIndex,
          itemsPerPage: slice.length,
          Resources: slice.map((u) => toScimUser(u, roles, base)),
        });
      },
    );

    fastify.get<{ Params: { id: string } }>(`${prefix}/Users/:id`, async (request, reply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return scimError(reply, 400, 'Tenant context required');
      const users = await allUsers(rolesService, tenantId);
      const user = users.find((u) => u.id === request.params.id);
      if (!user) return scimError(reply, 404, `User ${request.params.id} not found`);
      const roles = await rolesService.listRoles(tenantId);
      return send(reply, 200, toScimUser(user, roles, baseFor(request)));
    });

    fastify.post<{ Body: Partial<ScimUser> & { groups?: Array<{ value: string }> } }>(
      `${prefix}/Users`,
      async (request, reply) => {
        const tenantId = tenantOf(request);
        if (!tenantId) return scimError(reply, 400, 'Tenant context required');
        const body = request.body ?? {};
        const email = (body.userName ?? body.emails?.[0]?.value ?? '').trim().toLowerCase();
        if (!email) return scimError(reply, 400, 'userName is required', 'invalidValue');
        const roles = await rolesService.listRoles(tenantId);
        const roleIds = (body.groups ?? [])
          .map((g) => g.value)
          .filter((id) => roles.some((r) => r.id === id));
        try {
          let user = await rolesService.inviteUser(tenantId, {
            email,
            displayName: body.displayName ?? body.name?.formatted ?? email,
            roleIds,
          });
          if (body.active === false)
            user = await rolesService.setUserStatus(tenantId, user.id, 'SUSPENDED');
          return send(reply, 201, toScimUser(user, roles, baseFor(request)));
        } catch (error) {
          return mapError(reply, error);
        }
      },
    );

    fastify.put<{ Params: { id: string }; Body: Partial<ScimUser> }>(
      `${prefix}/Users/:id`,
      async (request, reply) => {
        const tenantId = tenantOf(request);
        if (!tenantId) return scimError(reply, 400, 'Tenant context required');
        const users = await allUsers(rolesService, tenantId);
        const user = users.find((u) => u.id === request.params.id);
        if (!user) return scimError(reply, 404, `User ${request.params.id} not found`);
        try {
          let updated = user;
          if (typeof request.body?.active === 'boolean') {
            updated = await rolesService.setUserStatus(
              tenantId,
              user.id,
              request.body.active ? 'ACTIVE' : 'SUSPENDED',
            );
          }
          const roles = await rolesService.listRoles(tenantId);
          return send(reply, 200, toScimUser(updated, roles, baseFor(request)));
        } catch (error) {
          return mapError(reply, error);
        }
      },
    );

    fastify.patch<{
      Params: { id: string };
      Body: { schemas?: string[]; Operations?: PatchOperation[] };
    }>(`${prefix}/Users/:id`, async (request, reply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return scimError(reply, 400, 'Tenant context required');
      const ops = request.body?.Operations;
      if (!Array.isArray(ops) || !request.body?.schemas?.includes(SCIM_PATCH)) {
        return scimError(reply, 400, 'PatchOp body with Operations required', 'invalidSyntax');
      }
      const users = await allUsers(rolesService, tenantId);
      const user = users.find((u) => u.id === request.params.id);
      if (!user) return scimError(reply, 404, `User ${request.params.id} not found`);
      try {
        let updated = user;
        const active = activeFromPatch(ops);
        if (active !== undefined) {
          updated = await rolesService.setUserStatus(
            tenantId,
            user.id,
            active ? 'ACTIVE' : 'SUSPENDED',
          );
        }
        const roles = await rolesService.listRoles(tenantId);
        return send(reply, 200, toScimUser(updated, roles, baseFor(request)));
      } catch (error) {
        return mapError(reply, error);
      }
    });

    // SCIM DELETE deprovisions; the directory keeps the record (audit) but suspends it.
    fastify.delete<{ Params: { id: string } }>(`${prefix}/Users/:id`, async (request, reply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return scimError(reply, 400, 'Tenant context required');
      try {
        await rolesService.setUserStatus(tenantId, request.params.id, 'SUSPENDED');
        return reply.code(204).send();
      } catch (error) {
        return mapError(reply, error);
      }
    });

    // ── Groups (tenant roles) ────────────────────────────────────────────
    fastify.get<{ Querystring: { filter?: string } }>(
      `${prefix}/Groups`,
      async (request, reply) => {
        const tenantId = tenantOf(request);
        if (!tenantId) return scimError(reply, 400, 'Tenant context required');
        const base = baseFor(request);
        let roles = await rolesService.listRoles(tenantId);
        const filter = parseEqFilter(request.query.filter);
        if (filter?.attribute === 'displayname') {
          roles = roles.filter((r) => r.name.toLowerCase() === filter.value.toLowerCase());
        }
        const users = await allUsers(rolesService, tenantId);
        return send(reply, 200, {
          schemas: [SCIM_LIST],
          totalResults: roles.length,
          startIndex: 1,
          itemsPerPage: roles.length,
          Resources: roles.map((r) =>
            toScimGroup(
              r,
              users.filter((u) => u.roleIds.includes(r.id)),
              base,
            ),
          ),
        });
      },
    );

    fastify.get<{ Params: { id: string } }>(`${prefix}/Groups/:id`, async (request, reply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return scimError(reply, 400, 'Tenant context required');
      try {
        const role = await rolesService.getRole(tenantId, request.params.id);
        const users = await allUsers(rolesService, tenantId);
        return send(
          reply,
          200,
          toScimGroup(
            role,
            users.filter((u) => u.roleIds.includes(role.id)),
            baseFor(request),
          ),
        );
      } catch (error) {
        return mapError(reply, error);
      }
    });

    fastify.patch<{
      Params: { id: string };
      Body: { schemas?: string[]; Operations?: PatchOperation[] };
    }>(`${prefix}/Groups/:id`, async (request, reply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return scimError(reply, 400, 'Tenant context required');
      const ops = request.body?.Operations;
      if (!Array.isArray(ops) || !request.body?.schemas?.includes(SCIM_PATCH)) {
        return scimError(reply, 400, 'PatchOp body with Operations required', 'invalidSyntax');
      }
      try {
        const role = await rolesService.getRole(tenantId, request.params.id);
        const users = await allUsers(rolesService, tenantId);
        const current = new Set(users.filter((u) => u.roleIds.includes(role.id)).map((u) => u.id));
        const desired = new Set(current);
        for (const op of ops) {
          const kind = op.op.toLowerCase();
          const path = op.path?.trim().toLowerCase();
          if (kind === 'add' && (!path || path === 'members')) {
            memberIds(op.value).forEach((id) => desired.add(id));
          } else if (kind === 'replace' && (!path || path === 'members')) {
            desired.clear();
            memberIds(op.value).forEach((id) => desired.add(id));
          } else if (kind === 'remove') {
            const single = memberFromPath(op.path);
            if (single) desired.delete(single);
            else if (path === 'members') {
              const ids = memberIds(op.value);
              if (ids.length === 0) desired.clear();
              else ids.forEach((id) => desired.delete(id));
            }
          }
        }
        for (const userId of desired) {
          if (current.has(userId)) continue;
          const user = users.find((u) => u.id === userId);
          if (!user) return scimError(reply, 400, `Member ${userId} not found`, 'invalidValue');
          await rolesService.assignRolesToUser(tenantId, userId, [...user.roleIds, role.id]);
        }
        for (const userId of current) {
          if (desired.has(userId)) continue;
          const user = users.find((u) => u.id === userId)!;
          await rolesService.assignRolesToUser(
            tenantId,
            userId,
            user.roleIds.filter((rid) => rid !== role.id),
          );
        }
        const refreshed = await allUsers(rolesService, tenantId);
        return send(
          reply,
          200,
          toScimGroup(
            role,
            refreshed.filter((u) => u.roleIds.includes(role.id)),
            baseFor(request),
          ),
        );
      } catch (error) {
        return mapError(reply, error);
      }
    });

    function mapError(reply: FastifyReply, error: unknown) {
      const status = (error as { statusCode?: number }).statusCode;
      const message = error instanceof Error ? error.message : 'SCIM request failed';
      if (status === 404) return scimError(reply, 404, message);
      if (status === 409) return scimError(reply, 409, message, 'uniqueness');
      if (status === 400 || status === 422) return scimError(reply, 400, message, 'invalidValue');
      throw error;
    }
  },
  { name: 'scim-plugin' },
);
