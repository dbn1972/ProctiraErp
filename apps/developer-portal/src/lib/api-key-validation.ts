/**
 * Client-side API key request validation for the developer dashboard demo.
 * Live minting is not connected; these checks keep the honesty demo consistent
 * and reject unsafe / reserved names before any future mint path.
 */

export const API_KEY_SCOPES = ['students:read', 'attendance:write', 'webhooks:manage'] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export interface ApiKeyRequestInput {
  name?: unknown;
  scope?: unknown;
}

export interface ApiKeyRequestErrors {
  name?: string;
  scope?: string;
}

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9 _.-]{1,62}[a-zA-Z0-9]$/;
const RESERVED_NAMES = new Set(['admin', 'root', 'system', 'default', 'test', 'null', 'undefined']);

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Validate a demo API-key request. Returns field errors or null when valid.
 */
export function validateApiKeyRequest(input: ApiKeyRequestInput): ApiKeyRequestErrors | null {
  const name = asString(input.name).trim();
  const scope = asString(input.scope).trim();
  const errors: ApiKeyRequestErrors = {};

  if (!name) {
    errors.name = 'Key name is required.';
  } else if (name.length < 3) {
    errors.name = 'Key name must be at least 3 characters.';
  } else if (name.length > 64) {
    errors.name = 'Key name must be at most 64 characters.';
  } else if (/\s{2,}/.test(name)) {
    errors.name = 'Key name must not contain consecutive spaces.';
  } else if (!NAME_RE.test(name)) {
    errors.name =
      'Key name must start and end with alphanumeric characters (letters, numbers, spaces, ., _, - allowed).';
  } else if (RESERVED_NAMES.has(name.toLowerCase())) {
    errors.name = 'Key name is reserved.';
  }

  if (!scope) {
    errors.scope = 'Scope is required.';
  } else if (!(API_KEY_SCOPES as readonly string[]).includes(scope)) {
    errors.scope = 'Scope is not in the allowlist.';
  }

  return Object.keys(errors).length > 0 ? errors : null;
}
