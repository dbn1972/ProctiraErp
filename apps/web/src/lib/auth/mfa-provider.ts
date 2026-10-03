/**
 * PRC-H019 — who owns TOTP enrolment.
 *
 * `keycloak` (default): enrolment is Keycloak's OTP required action
 * (`kc_action=CONFIGURE_TOTP`); the realm makes CONFIGURE_TOTP a default
 * required action so sign-in demands a second factor. Proctira never sees the
 * TOTP secret or recovery codes.
 *
 * `auth-service`: legacy proxy to an external auth service that issues and
 * persists the secret itself (`AUTH_SERVICE_URL/auth/mfa/setup`). Only use it
 * when that service is deployed; there is no Proctira-side secret storage.
 *
 * Any other value fails closed to `keycloak`.
 */
export type MfaEnrolmentProvider = 'keycloak' | 'auth-service';

export function mfaEnrolmentProvider(env: NodeJS.ProcessEnv = process.env): MfaEnrolmentProvider {
  return env['MFA_ENROLMENT_PROVIDER']?.trim().toLowerCase() === 'auth-service'
    ? 'auth-service'
    : 'keycloak';
}

/** Web path Keycloak returns to after the enrolment action completes. */
export const MFA_ENROLMENT_RETURN_PATH = '/dashboard';
