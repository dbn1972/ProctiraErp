/**
 * g7_platform-004 — sensitive notification template variable handling.
 *
 * Notification variables routinely carry password-reset links, OTPs, verification codes and bearer
 * tokens. Those must never be persisted or returned by the inbox/status APIs in plaintext: any
 * actor who can read a user's notifications (or a leaked backup) would otherwise obtain live reset
 * links / OTPs.
 *
 * Classification is fail-closed and layered:
 *   - a built-in denylist of common sensitive key-name patterns (otp, token, reset link, password,
 *     secret, verification code, …) always applies;
 *   - a template MAY declare an explicit `sensitiveVariables` allowlist to mark additional names;
 *   - a template MAY declare `publicVariables` to EXCLUDE a name the denylist would otherwise
 *     catch (e.g. a display field literally named "resetName") — this is an explicit opt-out, so a
 *     typo defaults to redaction, never to leaking.
 *
 * `redactSensitiveVariables` returns a copy safe to persist / return: sensitive values are replaced
 * with a fixed REDACTED marker. The original (unredacted) map is used only transiently to render
 * the outbound message at send time and is never stored.
 */

export const REDACTED_MARKER = '[REDACTED]';

/**
 * Case-insensitive substring patterns that mark a variable name as sensitive by default.
 */
const DEFAULT_SENSITIVE_PATTERNS: readonly string[] = [
  'otp',
  'token',
  'secret',
  'password',
  'passwd',
  'pwd',
  'reset',
  'resetlink',
  'reset_link',
  'reset-link',
  'verificationcode',
  'verification_code',
  'verify',
  'verifycode',
  'onetimecode',
  'one_time_code',
  'onetime',
  'mfa',
  'twofactor',
  'two_factor',
  '2fa',
  'pin',
  'apikey',
  'api_key',
  'authcode',
  'auth_code',
  'bearer',
  'credential',
  'activationcode',
  'activation_code',
  'magiclink',
  'magic_link',
];

export interface SensitiveClassifierTemplate {
  /** Explicit extra variable names to treat as sensitive (allowlist). */
  sensitiveVariables?: string[] | null;
  /** Explicit variable names to treat as NOT sensitive (opt-out of the denylist). */
  publicVariables?: string[] | null;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s_-]/g, '');
}

/**
 * Decide whether a single variable name is sensitive under the given template policy.
 */
export function isSensitiveVariableName(
  name: string,
  template?: SensitiveClassifierTemplate,
): boolean {
  const normalized = normalizeName(name);
  // Explicit public opt-out wins — but only this exact name.
  const publicSet = new Set((template?.publicVariables ?? []).map(normalizeName));
  if (publicSet.has(normalized)) {
    return false;
  }
  // Explicit sensitive allowlist.
  const sensitiveSet = new Set((template?.sensitiveVariables ?? []).map(normalizeName));
  if (sensitiveSet.has(normalized)) {
    return true;
  }
  // Built-in denylist (substring match on normalized name).
  return DEFAULT_SENSITIVE_PATTERNS.some((pattern) => normalized.includes(normalizeName(pattern)));
}

/**
 * Return a copy of `variables` with every sensitive value replaced by the REDACTED marker. Safe to
 * persist and to return from inbox/status APIs. Non-sensitive display fields are preserved.
 */
export function redactSensitiveVariables(
  variables: Record<string, string>,
  template?: SensitiveClassifierTemplate,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    out[key] = isSensitiveVariableName(key, template) ? REDACTED_MARKER : value;
  }
  return out;
}

/**
 * True when at least one variable is sensitive (i.e. redaction changed something).
 */
export function hasSensitiveVariables(
  variables: Record<string, string>,
  template?: SensitiveClassifierTemplate,
): boolean {
  return Object.keys(variables).some((k) => isSensitiveVariableName(k, template));
}
