/**
 * User invite request/response types + lightweight validation.
 *
 * TypeBox is intentionally omitted so @proctira/backend-auth stays free of
 * an extra schema compiler dependency on main.
 */

export interface InviteUserInput {
  email: string;
  roleId?: string;
  displayName?: string;
}

export interface InviteUserResponse {
  id: string;
  email: string;
  displayName: string | null;
  roleId: string | null;
  status: string;
  inviteUrl: string;
  expiresAt: string;
  emailSent: boolean;
  createdAt: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface InviteValidationError {
  field: string;
  rule: string;
  message: string;
}

export function validateInviteUserInput(
  body: unknown,
):
  | { success: true; data: InviteUserInput }
  | { success: false; errors: InviteValidationError[] } {
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
