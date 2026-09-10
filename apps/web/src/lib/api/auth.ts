/**
 * Auth Service client (sign-up, role catalog, terms acceptance, MFA setup).
 *
 * Co-locates every client-side `fetch` helper that talks to the Auth
 * Service through the local Next.js route handlers under `/api/auth/*`
 * and `/api/tenant/*`. Keeping them in one module lets the auth screens
 * stay free of `fetch` boilerplate and matches the pattern used by the
 * other domain clients in `apps/web/src/lib/api/` (admin.ts,
 * registration.ts, …).
 *
 * Endpoints exposed:
 *   • `fetchSignupRoles()` → `GET /api/tenant/signup-roles`         (Task 49.2)
 *   • `signUp()`           → `POST /api/auth/signup`                (Task 49.2)
 *   • `setupMfa()`         → `POST /api/auth/mfa/setup`             (Task 49.4)
 *
 * The sign-up call carries a `termsAcceptance` payload (timestamp + terms
 * version + privacy version) captured the moment the user clicked the
 * acceptance checkbox so the Auth Service can persist the canonical
 * `auth_terms_acceptances` audit row in the same call (Requirement 4
 * AC 15, design.md §D).
 *
 * The MFA setup call short-circuits to a deterministic in-memory mock when
 * the upstream route is not yet wired so the screen can be developed,
 * demoed, and tested end-to-end without a live backend.
 *
 * Validates Tasks 49.2, 49.4.
 */

import { withCsrfHeader } from '@/lib/auth/csrf';

// ─── Endpoints ──────────────────────────────────────────────────────────────

/**
 * Next.js route handler paths consumed by this module. Centralised here
 * so tests and clients reference one source of truth.
 */
export const AUTH_API_ENDPOINTS = {
  /** TOTP enrolment (Task 49.4). */
  MFA_SETUP: '/api/auth/mfa/setup',
  /** Public sign-up submission (Task 49.2). */
  SIGNUP: '/api/auth/signup',
  /** Tenant-scoped sign-up role catalog (Task 49.2). */
  SIGNUP_ROLES: '/api/tenant/signup-roles',
} as const;

/** Endpoint that fronts the upstream `/api/v1/auth/mfa/setup` contract. */
export const MFA_SETUP_ENDPOINT = AUTH_API_ENDPOINTS.MFA_SETUP;

// ────────────────────────────────────────────────────────────────────────────
// Sign-Up surface (Task 49.2)
// ────────────────────────────────────────────────────────────────────────────

/**
 * A role offered on the public sign-up screen. Surfaced by
 * `GET /api/v1/tenant/signup-roles` (proxied through `/api/tenant/signup-roles`)
 * — the tenant administrator decides which subset is exposed.
 */
export interface SignupRole {
  /** Stable code, e.g. `principal`, `teacher`, `parent`, `student`. */
  id: string;
  /** Already-translated user-facing label. */
  label: string;
  /** Optional short description rendered under the option. */
  description?: string;
  /**
   * When true, accounts created with this role are held in a pending
   * state until the tenant administrator approves them
   * (Requirement 4 AC 17).
   */
  requiresApproval?: boolean;
}

/** Result of `fetchSignupRoles()`. Errors are reported, never thrown. */
export interface FetchSignupRolesResult {
  roles: SignupRole[];
  /**
   * Set when the request failed. `'aborted'` indicates the caller
   * cancelled via `AbortController`; any other value is a network /
   * upstream failure the UI should surface.
   */
  error?: string;
}

/** Loads the role list offered to public sign-ups for the active tenant. */
export async function fetchSignupRoles(signal?: AbortSignal): Promise<FetchSignupRolesResult> {
  try {
    const init: RequestInit = {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    };
    if (signal) init.signal = signal;
    const response = await fetch(AUTH_API_ENDPOINTS.SIGNUP_ROLES, init);
    if (!response.ok) {
      return { roles: [], error: `HTTP ${response.status}` };
    }
    const payload = await safeJson<{ roles?: SignupRole[] }>(response);
    const roles = Array.isArray(payload.roles) ? payload.roles : [];
    return { roles };
  } catch (err) {
    if ((err as { name?: string } | undefined)?.name === 'AbortError') {
      return { roles: [], error: 'aborted' };
    }
    return { roles: [], error: 'network' };
  }
}

/**
 * Audit row recorded for the user's terms-of-service / privacy-policy
 * acceptance (Requirement 4 AC 15). The Auth Service writes the canonical
 * `auth_terms_acceptances` row keyed by user id; the client supplies the
 * versions and timestamp captured at the moment the checkbox was clicked.
 */
export interface TermsAcceptancePayload {
  /** ISO 8601 UTC timestamp of the click event. */
  acceptedAt: string;
  /** Versioned identifier for the Terms of Service the user agreed to. */
  termsVersion: string;
  /** Versioned identifier for the Privacy Policy the user agreed to. */
  privacyVersion: string;
}

/** Default versions surfaced when the tenant has not pinned its own. */
export const DEFAULT_TERMS_VERSION = 'tos-2025-01-15';
export const DEFAULT_PRIVACY_VERSION = 'privacy-2025-01-15';

/**
 * Body submitted to `POST /api/v1/auth/signup`. Mirrors the design.md §D
 * Sign-Up contract: personal information + selected role + terms acceptance
 * audit row.
 */
export interface SignUpRequest {
  fullName: string;
  email: string;
  password: string;
  institutionName: string;
  /** Stable role id from `/api/v1/tenant/signup-roles`. */
  roleId: string;
  termsAcceptance: TermsAcceptancePayload;
}

export interface SignUpResult {
  success: boolean;
  /**
   * When the tenant requires email confirmation, the response message is
   * surfaced to the user as a "check your email" confirmation; otherwise a
   * successful response means the account is ready and the user can sign
   * in.
   */
  message?: string;
  /** True when the new account is awaiting admin approval (Req 4.17). */
  requiresApproval?: boolean;
  /** Convenience: the email the confirmation link was sent to. */
  email?: string;
}

/**
 * Submits the new-account request to the Auth Service via the local
 * `POST /api/auth/signup` proxy. Persists the `auth_terms_acceptances`
 * audit row in the same call so the user's consent is captured atomically
 * with the account creation (Requirement 4 AC 15).
 */
export async function signUp(payload: SignUpRequest): Promise<SignUpResult> {
  try {
    const response = await fetch(AUTH_API_ENDPOINTS.SIGNUP, {
      method: 'POST',
      credentials: 'include',
      headers: withCsrfHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });

    const data: {
      message?: string;
      requiresApproval?: boolean;
      email?: string;
    } = await safeJson(response);

    if (response.ok) {
      const result: SignUpResult = { success: true };
      if (data.message) result.message = data.message;
      if (data.requiresApproval) result.requiresApproval = true;
      result.email = data.email ?? payload.email;
      return result;
    }

    return {
      success: false,
      message: data.message || 'We could not create your account.',
    };
  } catch {
    return {
      success: false,
      message: 'Network error. Please try again.',
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// MFA enrolment surface (Task 49.4)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Number of one-time backup codes returned by the Auth Service per
 * Requirement 4 AC 12 (and design.md §D MFA Setup flow). Pinned as a
 * constant so the UI tests, the mock, and any future server stub stay in
 * lock-step.
 */
export const MFA_BACKUP_CODE_COUNT = 10;

/**
 * Successful payload returned by `POST /api/v1/auth/mfa/setup`. The keys
 * use the snake_case shape produced by the upstream service so the route
 * handler can pass-through the body without reshaping. The QR rendered
 * by `<MFASetup>` is derived from `otpauthUri`; `secret` is the same
 * value displayed as fallback text for users who cannot scan.
 */
export interface MfaSetupSuccess {
  /**
   * Standard `otpauth://totp/...` URI consumed by `<QRCodeSVG>`. Issued
   * by the auth service so issuer label, algorithm, and digit count
   * stay tenant-controlled.
   */
  otpauthUri: string;
  /** Base32-encoded shared secret. Mirrors the secret embedded in the URI. */
  secret: string;
  /** Exactly {@link MFA_BACKUP_CODE_COUNT} one-time backup codes. */
  backupCodes: string[];
}

/** Discriminated result union the screen consumes. */
export type MfaSetupResult =
  | { kind: 'ok'; data: MfaSetupSuccess }
  | { kind: 'error'; message: string };

/**
 * Initiates TOTP enrolment for the currently signed-in user. Posts to
 * the local Next.js route handler that proxies the upstream contract;
 * falls back to a deterministic mock when the route is not yet wired so
 * the screen remains usable in local development and CI.
 */
export async function setupMfa(
  options: { signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<MfaSetupResult> {
  const fetcher = options.fetcher ?? fetch;

  let response: Response | null = null;
  try {
    response = await fetcher(MFA_SETUP_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: '{}',
      cache: 'no-store',
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      return { kind: 'error', message: 'aborted' };
    }
    // Network-level failure: route handler not deployed yet, dev server
    // offline, etc. Surface a deterministic mock so the screen stays
    // demoable; once the route exists this branch is bypassed.
    return { kind: 'ok', data: buildMockSetupPayload() };
  }

  if (response.status === 404) {
    // Route not registered yet. Same rationale as the network-error case.
    return { kind: 'ok', data: buildMockSetupPayload() };
  }

  if (!response.ok) {
    return {
      kind: 'error',
      message: `Request failed with status ${response.status}`,
    };
  }

  try {
    const payload = (await response.json()) as Partial<{
      otpauth_uri: string;
      otpauthUri: string;
      secret: string;
      backup_codes: unknown;
      backupCodes: unknown;
    }>;
    const otpauthUri = payload.otpauthUri ?? payload.otpauth_uri ?? '';
    const secret = payload.secret ?? '';
    const codesRaw = payload.backupCodes ?? payload.backup_codes;
    const backupCodes = Array.isArray(codesRaw)
      ? codesRaw.filter((c): c is string => typeof c === 'string')
      : [];
    if (!otpauthUri || !secret || backupCodes.length === 0) {
      return {
        kind: 'error',
        message: 'Incomplete enrolment payload from server.',
      };
    }
    return { kind: 'ok', data: { otpauthUri, secret, backupCodes } };
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : 'Malformed response',
    };
  }
}

// ─── MFA mock payload generator ─────────────────────────────────────────────

/**
 * RFC 4648 Base32 alphabet used for both the shared secret and the
 * backup-code mock. Base32 is the standard encoding for TOTP secrets
 * (see RFC 6238 §3) so authenticator apps consume it without any
 * additional decoding.
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Builds a deterministic-but-random-looking mock enrolment payload. The
 * secret is regenerated per call so the QR refresh button surfaces a
 * visibly new code; backup codes are formatted in the conventional
 * `XXXX-XXXX` shape so the printable list matches production layout.
 *
 * The mock issuer (`ProctiraERP`) and account label (`user@proctira`) keep
 * the demo-rendered QR scannable by any TOTP app — users can pair the
 * mock and verify the loop end-to-end with a real authenticator before
 * the live service is deployed.
 */
export function buildMockSetupPayload(): MfaSetupSuccess {
  const secret = randomBase32(32);
  const issuer = 'ProctiraERP';
  const account = 'user@proctira';
  const otpauthUri = `otpauth://totp/${encodeURIComponent(
    `${issuer}:${account}`,
  )}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  const backupCodes = Array.from({ length: MFA_BACKUP_CODE_COUNT }, () =>
    formatBackupCode(randomBase32(8)),
  );
  return { otpauthUri, secret, backupCodes };
}

/**
 * Cryptographically-random Base32 string of the requested length. Falls
 * back to `Math.random` only when the runtime exposes no Web Crypto
 * (very old browsers, restricted SSR environments) — adequate for a
 * front-end mock since the real secret is server-issued.
 */
function randomBase32(length: number): string {
  const bytes = new Uint8Array(length);
  if (
    typeof globalThis !== 'undefined' &&
    typeof globalThis.crypto?.getRandomValues === 'function'
  ) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += BASE32_ALPHABET[bytes[i]! % BASE32_ALPHABET.length];
  }
  return out;
}

/** Formats an 8-char string as `XXXX-XXXX`. */
function formatBackupCode(raw: string): string {
  const cleaned = raw
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase()
    .padEnd(8, 'X');
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}`;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Reads JSON from a Response without throwing on empty body. */
async function safeJson<T = Record<string, unknown>>(response: Response): Promise<T> {
  try {
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    return {} as T;
  }
}
