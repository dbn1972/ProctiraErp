/**
 * PRC-H043: Resource-Owner Password Credentials (POST /auth/password) policy.
 *
 * Defaulted decision: ROPC is disabled in production (auth-code + PKCE is the supported
 * sign-in); owners may re-enable it with AUTH_PASSWORD_GRANT=enabled. When enabled, the
 * second factor is enforced by Keycloak's direct-grant flow (conditional OTP): the gateway
 * forwards the caller's one-time code as `totp` and never issues tokens itself.
 */
export type PasswordGrantMode = 'enabled' | 'disabled';

export function readPasswordGrantMode(
  env: Record<string, string | undefined> = process.env,
): PasswordGrantMode {
  const raw = env['AUTH_PASSWORD_GRANT']?.trim().toLowerCase();
  if (raw === 'enabled' || raw === 'disabled') return raw;
  if (raw) {
    throw new Error(`AUTH_PASSWORD_GRANT must be 'enabled' or 'disabled' (got '${raw}')`);
  }
  return env['NODE_ENV'] === 'production' ? 'disabled' : 'enabled';
}

/** Second-factor code from the request body (`otp` or `totp`), digits only, 6-8 long. */
export function readOneTimeCode(body: { otp?: unknown; totp?: unknown } | undefined): {
  code?: string;
  invalid: boolean;
} {
  const raw = body?.otp ?? body?.totp;
  if (raw === undefined || raw === null || raw === '') return { invalid: false };
  const code = String(raw).trim();
  return /^\d{6,8}$/.test(code) ? { code, invalid: false } : { invalid: true };
}
