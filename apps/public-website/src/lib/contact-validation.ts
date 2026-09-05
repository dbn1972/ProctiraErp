/**
 * Shared contact-form validation for the Public Website.
 *
 * Used by both the client form and `POST /api/contact` so client and
 * server stay in lockstep (enterprise: no divergent validation).
 */

export const CONTACT_LIMITS = {
  nameMax: 120,
  emailMax: 254,
  organizationMax: 160,
  messageMin: 10,
  messageMax: 4_000,
} as const;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ContactInput {
  name?: unknown;
  email?: unknown;
  organization?: unknown;
  message?: unknown;
  /** Honeypot — must be empty when present. */
  website?: unknown;
}

export interface ContactFieldErrors {
  name?: string;
  email?: string;
  organization?: string;
  message?: string;
  form?: string;
}

export interface ValidatedContact {
  name: string;
  email: string;
  organization: string;
  message: string;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Validate and normalize a contact payload.
 *
 * Returns either field errors (any key set) or a trimmed payload.
 */
export function validateContactInput(
  input: ContactInput,
): { ok: true; value: ValidatedContact } | { ok: false; errors: ContactFieldErrors } {
  const honeypot = asString(input.website).trim();
  if (honeypot.length > 0) {
    return { ok: false, errors: { form: 'Unable to submit this form.' } };
  }

  const name = asString(input.name).trim();
  const email = asString(input.email).trim();
  const organization = asString(input.organization).trim();
  const message = asString(input.message).trim();

  const errors: ContactFieldErrors = {};

  if (!name) {
    errors.name = 'Name is required.';
  } else if (name.length > CONTACT_LIMITS.nameMax) {
    errors.name = `Name must be at most ${CONTACT_LIMITS.nameMax} characters.`;
  }

  if (!email) {
    errors.email = 'A valid email address is required.';
  } else if (email.length > CONTACT_LIMITS.emailMax || !EMAIL_RE.test(email)) {
    errors.email = 'A valid email address is required.';
  }

  if (organization.length > CONTACT_LIMITS.organizationMax) {
    errors.organization = `Organization must be at most ${CONTACT_LIMITS.organizationMax} characters.`;
  }

  if (!message || message.length < CONTACT_LIMITS.messageMin) {
    errors.message = `Message must be at least ${CONTACT_LIMITS.messageMin} characters.`;
  } else if (message.length > CONTACT_LIMITS.messageMax) {
    errors.message = `Message must be at most ${CONTACT_LIMITS.messageMax} characters.`;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: { name, email, organization, message } };
}
