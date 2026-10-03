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
 *     PUT/PATCH: userName/emails, displayName/name.*, externalId, active
 *     (PRC-M025); any other PATCH path → 400 scimType invalidPath.
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
    ...(user.externalId ? { externalId: user.externalId } : {}),
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

export type ScimUserChange = {
  displayName?: string;
  email?: string;
  externalId?: string | null;
  active?: boolean;
};

/** Thrown for a PATCH path / op this server does not implement (→ 400 invalidPath). */
export class ScimInvalidPathError extends Error {
  constructor(readonly path: string) {
    super(`Unsupported attribute path '${path}'`);
  }
}

function boolOf(v: unknown): boolean {
  return v === true || v === 'True' || v === 'true';
}

function firstEmail(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const items = value as Array<{ value?: unknown; primary?: unknown }>;
    const pick = items.find((e) => e?.primary === true) ?? items[0];
    return typeof pick?.value === 'string' ? pick.value : undefined;
  }
  return undefined;
}

/**
 * PRC-M025: apply one attribute (path is lower-cased) to the change set.
 * `name.givenName` / `name.familyName` recompose displayName from `current`.
 */
function applyUserAttribute(
  change: ScimUserChange,
  path: string,
  value: unknown,
  current: { displayName: string },
): void {
  switch (path) {
    case 'active':
      change.active = boolOf(value);
      return;
    case 'displayname':
    case 'name.formatted':
      if (typeof value === 'string') change.displayName = value;
      return;
    case 'name': {
      const v = (value ?? {}) as { formatted?: unknown; givenName?: unknown; familyName?: unknown };
      if (typeof v.formatted === 'string') change.displayName = v.formatted;
      else if (typeof v.givenName === 'string' || typeof v.familyName === 'string') {
        change.displayName = [v.givenName, v.familyName].filter((x) => typeof x === 'string').join(' ');
      }
      return;
    }
    case 'name.givenname':
    case 'name.familyname': {
      const base = (change.displayName ?? current.displayName).trim().split(/\s+/);
      const given = path === 'name.givenname' ? String(value ?? '') : (base[0] ?? '');
      const family = path === 'name.familyname' ? String(value ?? '') : base.slice(1).join(' ');
      change.displayName = [given, family].filter(Boolean).join(' ');
      return;
    }
    case 'username':
      if (typeof value === 'string') change.email = value;
      return;
    case 'emails':
    case 'emails[type eq "work"].value':
    case 'emails[primary eq true].value': {
      const email = firstEmail(value);
      if (email) change.email = email;
      return;
    }
    case 'externalid':
      change.externalId = typeof value === 'string' ? value : null;
      return;
    default:
      throw new ScimInvalidPathError(path);
  }
}

/** PRC-M025: translate a User PatchOp into a change set; unsupported paths throw. */
export function userChangeFromPatch(
  operations: PatchOperation[],
  current: { displayName: string },
): ScimUserChange {
  const change: ScimUserChange = {};
  for (const op of operations) {
    const kind = String(op.op ?? '').toLowerCase();
    const path = op.path?.trim().toLowerCase();
    if (kind === 'remove') {
      if (path === 'externalid') change.externalId = null;
      else throw new ScimInvalidPathError(op.path ?? '');
      continue;
    }
    if (kind !== 'replace' && kind !== 'add') throw new ScimInvalidPathError(op.path ?? kind);
    if (path) {
      applyUserAttribute(change, path, op.value, current);
    } else if (op.value && typeof op.value === 'object') {
      for (const [key, value] of Object.entries(op.value as Record<string, unknown>)) {
        applyUserAttribute(change, key.toLowerCase(), value, current);
      }
    } else {
      throw new ScimInvalidPathError('');
    }
  }
  return change;
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

/** Directory scan — only for list/filter endpoints that genuinely need the set. */
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
              { name: 'externalId', type: 'string', required: false },
              { name: 'displayName', type: 'string', required: false },
              {
                name: 'name',
                type: 'complex',
                subAttributes: [
                  { name: 'formatted', type: 'string' },
                  { name: 'givenName', type: 'string' },
                  { name: 'familyName', type: 'string' },
                ],
              },
              { name: 'active', type: 'boolean', required: false },
              { name: 'emails', type: 'complex', multiValued: true },
              { name: 'groups', type: 'complex', multiValued: true, mutability: 'readOnly' },
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
                return (u.externalId ?? '').toLowerCase() === needle;
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

    // PRC-M026: one-row lookups instead of loading the whole tenant directory.
    const findUser = async (tenantId: string, id: string): Promise<UserRecord | null> => {
      try {
        return await rolesService.getUser(tenantId, id);
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 404) return null;
        throw error;
      }
    };

    /** Members of one role via the repository roleId filter (paged, capped). */
    const membersOf = async (tenantId: string, roleId: string): Promise<UserRecord[]> => {
      const out: UserRecord[] = [];
      for (let page = 1; page <= 50; page += 1) {
        const result = await rolesService.listUsers(tenantId, { roleId }, { page, pageSize: 200 });
        out.push(...result.data);
        if (result.data.length < 200 || out.length >= result.meta.totalItems) break;
      }
      return out;
    };

    /** PRC-M025: persist profile + status changes; returns the updated record. */
    const applyUserChange = async (
      tenantId: string,
      user: UserRecord,
      change: ScimUserChange,
    ): Promise<UserRecord> => {
      let updated = user;
      if (
        change.displayName !== undefined ||
        change.email !== undefined ||
        change.externalId !== undefined
      ) {
        updated = await rolesService.updateUserProfile(tenantId, user.id, {
          ...(change.displayName !== undefined ? { displayName: change.displayName } : {}),
          ...(change.email !== undefined ? { email: change.email } : {}),
          ...(change.externalId !== undefined ? { externalId: change.externalId } : {}),
        });
      }
      if (change.active !== undefined) {
        updated = await rolesService.setUserStatus(
          tenantId,
          user.id,
          change.active ? 'ACTIVE' : 'SUSPENDED',
        );
      }
      return updated;
    };

    fastify.get<{ Params: { id: string } }>(`${prefix}/Users/:id`, async (request, reply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return scimError(reply, 400, 'Tenant context required');
      const user = await findUser(tenantId, request.params.id);
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
          if (typeof body.externalId === 'string' && body.externalId.trim()) {
            user = await rolesService.updateUserProfile(tenantId, user.id, {
              externalId: body.externalId,
            });
          }
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
        const user = await findUser(tenantId, request.params.id);
        if (!user) return scimError(reply, 404, `User ${request.params.id} not found`);
        // PRC-M025: PUT replaces the supported writable attributes (groups is
        // read-only on User per RFC 7643 §4.1.2 and is managed via /Groups).
        const body = request.body ?? {};
        const change: ScimUserChange = {};
        const email = body.userName ?? firstEmail(body.emails);
        if (typeof email === 'string') change.email = email;
        const name = body.displayName ?? body.name?.formatted;
        if (typeof name === 'string') change.displayName = name;
        if ('externalId' in body) {
          change.externalId = typeof body.externalId === 'string' ? body.externalId : null;
        }
        if (typeof body.active === 'boolean') change.active = body.active;
        try {
          const updated = await applyUserChange(tenantId, user, change);
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
      const user = await findUser(tenantId, request.params.id);
      if (!user) return scimError(reply, 404, `User ${request.params.id} not found`);
      let change: ScimUserChange;
      try {
        change = userChangeFromPatch(ops, user);
      } catch (error) {
        if (error instanceof ScimInvalidPathError) {
          return scimError(reply, 400, error.message, 'invalidPath');
        }
        throw error;
      }
      try {
        const updated = await applyUserChange(tenantId, user, change);
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
        return send(
          reply,
          200,
          toScimGroup(role, await membersOf(tenantId, role.id), baseFor(request)),
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
        // PRC-M026: compute add/remove deltas, then apply each user's change as
        // one atomic membership update (no stale role-list snapshots), so
        // concurrent PATCHes of different groups for the same user both stick.
        const current = new Set((await membersOf(tenantId, role.id)).map((u) => u.id));
        const add = new Set<string>();
        const remove = new Set<string>();
        let replaceWith: Set<string> | null = null;
        for (const op of ops) {
          const kind = String(op.op ?? '').toLowerCase();
          const path = op.path?.trim().toLowerCase();
          if (kind === 'add' && (!path || path === 'members')) {
            memberIds(op.value).forEach((id) => {
              add.add(id);
              remove.delete(id);
            });
          } else if (kind === 'replace' && (!path || path === 'members')) {
            replaceWith = new Set(memberIds(op.value));
            add.clear();
            remove.clear();
          } else if (kind === 'remove' && (memberFromPath(op.path) || path === 'members')) {
            const single = memberFromPath(op.path);
            const ids = single ? [single] : memberIds(op.value);
            if (!single && ids.length === 0) {
              replaceWith = new Set();
              add.clear();
              remove.clear();
            } else {
              ids.forEach((id) => {
                remove.add(id);
                add.delete(id);
              });
            }
          } else {
            return scimError(reply, 400, `Unsupported attribute path '${op.path ?? ''}'`, 'invalidPath');
          }
        }
        if (replaceWith) {
          for (const id of current) if (!replaceWith.has(id) && !add.has(id)) remove.add(id);
          for (const id of replaceWith) if (!current.has(id) && !remove.has(id)) add.add(id);
        }
        for (const userId of add) {
          if (current.has(userId)) continue;
          if (!(await findUser(tenantId, userId))) {
            return scimError(reply, 400, `Member ${userId} not found`, 'invalidValue');
          }
          await rolesService.modifyUserRoles(tenantId, userId, { add: [role.id] });
        }
        for (const userId of remove) {
          if (!current.has(userId)) continue;
          await rolesService.modifyUserRoles(tenantId, userId, { remove: [role.id] });
        }
        return send(
          reply,
          200,
          toScimGroup(role, await membersOf(tenantId, role.id), baseFor(request)),
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
