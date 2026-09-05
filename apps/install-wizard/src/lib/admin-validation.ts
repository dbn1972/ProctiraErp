/**
 * Shared admin-account validation for the Install Wizard.
 * Used by the Admin step UI and unit tests so client checks stay consistent.
 */

export interface AdminAccountInput {
  email?: unknown;
  password?: unknown;
  confirmPassword?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  tenantName?: unknown;
  tenantSlug?: unknown;
}

export interface AdminAccountFieldErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
  firstName?: string;
  lastName?: string;
  tenantName?: string;
  tenantSlug?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9-]+$/;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Validate admin + tenant fields for the final install step.
 * Returns field errors (any key set) or null when valid.
 */
export function validateAdminAccount(
  input: AdminAccountInput,
): AdminAccountFieldErrors | null {
  const email = asString(input.email).trim();
  const password = asString(input.password);
  const confirmPassword = asString(input.confirmPassword);
  const firstName = asString(input.firstName).trim();
  const lastName = asString(input.lastName).trim();
  const tenantName = asString(input.tenantName).trim();
  const tenantSlug = asString(input.tenantSlug).trim();

  const errors: AdminAccountFieldErrors = {};

  if (!email) errors.email = 'Email is required';
  else if (!EMAIL_RE.test(email)) errors.email = 'Invalid email format';

  if (!password) errors.password = 'Password is required';
  else if (password.length < 8) errors.password = 'Password must be at least 8 characters';

  if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match';

  if (!firstName) errors.firstName = 'First name is required';
  if (!lastName) errors.lastName = 'Last name is required';
  if (!tenantName) errors.tenantName = 'Tenant name is required';

  if (!tenantSlug) errors.tenantSlug = 'Tenant slug is required';
  else if (!SLUG_RE.test(tenantSlug)) {
    errors.tenantSlug = 'Slug must be lowercase letters, numbers, and hyphens only';
  }

  return Object.keys(errors).length > 0 ? errors : null;
}
