/**
 * Roles & Permissions Schemas (Task 59.3)
 *
 * Typebox schemas for the Settings → Roles & Permissions REST surface.
 */
import { Type, type Static } from '@sinclair/typebox';

// ─── Shared shapes ─────────────────────────────────────────────────────────

export const PermissionActionEnum = Type.Union([
  Type.Literal('create'),
  Type.Literal('read'),
  Type.Literal('update'),
  Type.Literal('delete'),
  Type.Literal('list'),
  Type.Literal('manage'),
]);

export const PermissionRefSchema = Type.Object({
  resource: Type.String({ minLength: 1, maxLength: 100 }),
  action: PermissionActionEnum,
});

// ─── Role inputs ───────────────────────────────────────────────────────────

export const CreateRoleSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 80 }),
  description: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
  permissions: Type.Array(PermissionRefSchema, { maxItems: 500 }),
});
export type CreateRoleInput = Static<typeof CreateRoleSchema>;

export const UpdateRolePermissionsSchema = Type.Object({
  permissions: Type.Array(PermissionRefSchema, { maxItems: 500 }),
});
export type UpdateRolePermissionsInput = Static<typeof UpdateRolePermissionsSchema>;

export const UpdateRoleSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  description: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
  permissions: Type.Optional(Type.Array(PermissionRefSchema, { maxItems: 500 })),
});
export type UpdateRoleInput = Static<typeof UpdateRoleSchema>;

export const RoleParamsSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
});
export type RoleParams = Static<typeof RoleParamsSchema>;

// ─── User inputs ───────────────────────────────────────────────────────────

export const ListUsersQuerySchema = Type.Object({
  search: Type.Optional(Type.String({ maxLength: 100 })),
  roleId: Type.Optional(Type.String({ minLength: 1 })),
  status: Type.Optional(
    Type.Union([Type.Literal('ACTIVE'), Type.Literal('SUSPENDED'), Type.Literal('INVITED')]),
  ),
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
});
export type ListUsersQuery = Static<typeof ListUsersQuerySchema>;

export const AssignRolesToUserSchema = Type.Object({
  roleIds: Type.Array(Type.String({ minLength: 1 }), { maxItems: 50 }),
});
export type AssignRolesToUserInput = Static<typeof AssignRolesToUserSchema>;

export const UserParamsSchema = Type.Object({
  userId: Type.String({ minLength: 1 }),
});
export type UserParams = Static<typeof UserParamsSchema>;
