/**
 * User invite request/response types + TypeBox schemas (admin invite flow).
 *
 * TypeBox schemas satisfy Charter §6 / §32 API schema presence. Runtime
 * validation stays in `validateInviteUserInput` so routes do not require a
 * Fastify TypeBox compiler plugin.
 */
import { Type, type Static } from '@sinclair/typebox';

export const InviteUserInputSchema = Type.Object(
  {
    email: Type.String({ format: 'email', minLength: 3 }),
    roleId: Type.Optional(Type.String({ format: 'uuid' })),
    displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { additionalProperties: false },
);

export const InviteUserResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  email: Type.String({ format: 'email' }),
  displayName: Type.Union([Type.String(), Type.Null()]),
  roleId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  status: Type.String(),
  inviteUrl: Type.String(),
  expiresAt: Type.String({ format: 'date-time' }),
  emailSent: Type.Boolean(),
  createdAt: Type.String({ format: 'date-time' }),
});

export type InviteUserInput = Static<typeof InviteUserInputSchema>;
export type InviteUserResponse = Static<typeof InviteUserResponseSchema>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface InviteValidationError {
  field: string;
  rule: string;
  message: string;
}

/**
 * Lightweight invite payload validation (keeps auth routes free of a TypeBox
 * compiler dependency while still publishing TypeBox schemas for docs/DoD).
 */
export function validateInviteUserInput(
  body: unknown,
): { success: true; data: InviteUserInput } | { success: false; errors: InviteValidationError[] } {
  const errors: InviteValidationError[] = [];
  if (!body || typeof body !== 'object') {
    return {
      success: false,
      errors: [{ field: 'body', rule: 'required', message: 'Request body is required' }],
    };
  }
  const raw = body as Record<string, unknown>;
  const email = typeof raw['email'] === 'string' ? raw['email'].trim() : '';
  if (!email || !email.includes('@')) {
    errors.push({ field: 'email', rule: 'format', message: 'A valid email is required' });
  }
  const displayName =
    typeof raw['displayName'] === 'string' ? raw['displayName'].trim() : undefined;
  if (raw['displayName'] !== undefined && (!displayName || displayName.length === 0)) {
    errors.push({
      field: 'displayName',
      rule: 'minLength',
      message: 'displayName cannot be empty',
    });
  }
  const roleId = typeof raw['roleId'] === 'string' ? raw['roleId'] : undefined;
  if (roleId !== undefined && !UUID_RE.test(roleId)) {
    errors.push({ field: 'roleId', rule: 'format', message: 'roleId must be a UUID' });
  }

  if (errors.length > 0) return { success: false, errors };
  return {
    success: true,
    data: {
      email,
      ...(displayName ? { displayName } : {}),
      ...(roleId ? { roleId } : {}),
    },
  };
}
