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

/**
 * Dot-atom local part + hostname labels (letters/digits/hyphen, no leading or
 * trailing hyphen) + alphabetic or punycode TLD. Stricter than "x@y.z" while
 * still accepting plus-addressing and subdomains.
 */
export const EMAIL_RE =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})$/;

/** Any C0/C1 control character (includes CR/LF/TAB) or DEL. */
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/;
/** Control characters other than LF/TAB, which a multi-line message may keep. */
// eslint-disable-next-line no-control-regex
const MESSAGE_STRIP_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

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
  // Normalise CRLF/CR to LF, then drop other control characters from the body.
  const message = asString(input.message)
    .replace(/\r\n?/g, '\n')
    .replace(MESSAGE_STRIP_RE, '')
    .trim();

  const errors: ContactFieldErrors = {};

  if (!name) {
    errors.name = 'Name is required.';
  } else if (CONTROL_RE.test(name)) {
    errors.name = 'Name must be a single line without control characters.';
  } else if (name.length > CONTACT_LIMITS.nameMax) {
    errors.name = `Name must be at most ${CONTACT_LIMITS.nameMax} characters.`;
  }

  if (!email) {
    errors.email = 'A valid email address is required.';
  } else if (
    email.length > CONTACT_LIMITS.emailMax ||
    CONTROL_RE.test(email) ||
    !EMAIL_RE.test(email)
  ) {
    errors.email = 'A valid email address is required.';
  }

  if (CONTROL_RE.test(organization)) {
    errors.organization = 'Organization must be a single line without control characters.';
  } else if (organization.length > CONTACT_LIMITS.organizationMax) {
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
