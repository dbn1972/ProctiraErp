/**
 * W2-API-02: canonical error-code registry for public HTTP APIs.
 * W2-API-03: deprecation policy helpers live alongside the registry so
 * clients can discover both error contracts and sunset semantics.
 */

export interface ErrorCodeDefinition {
  code: string;
  httpStatus: number;
  description: string;
  since: string;
  retryable: boolean;
}

export const ERROR_CODE_REGISTRY: readonly ErrorCodeDefinition[] = [
  {
    code: 'VALIDATION_ERROR',
    httpStatus: 400,
    description: 'Request payload failed schema or business-field validation',
    since: '1.0.0',
    retryable: false,
  },
  {
    code: 'UNAUTHORIZED',
    httpStatus: 401,
    description: 'Authentication required or token invalid',
    since: '1.0.0',
    retryable: false,
  },
  {
    code: 'FORBIDDEN',
    httpStatus: 403,
    description: 'Authenticated principal lacks permission',
    since: '1.0.0',
    retryable: false,
  },
  {
    code: 'NOT_FOUND',
    httpStatus: 404,
    description: 'Requested resource was not found in the tenant scope',
    since: '1.0.0',
    retryable: false,
  },
  {
    code: 'CONFLICT',
    httpStatus: 409,
    description: 'Operation conflicts with existing state',
    since: '1.0.0',
    retryable: false,
  },
  {
    code: 'BUSINESS_RULE_ERROR',
    httpStatus: 422,
    description: 'Domain invariant or board rule rejected the operation',
    since: '1.0.0',
    retryable: false,
  },
  {
    code: 'RATE_LIMIT_EXCEEDED',
    httpStatus: 429,
    description: 'Caller exceeded the configured rate limit',
    since: '1.0.0',
    retryable: true,
  },
  {
    code: 'INTERNAL_ERROR',
    httpStatus: 500,
    description: 'Unexpected server error',
    since: '1.0.0',
    retryable: true,
  },
  {
    code: 'SERVICE_UNAVAILABLE',
    httpStatus: 503,
    description: 'Dependency or service temporarily unavailable',
    since: '1.0.0',
    retryable: true,
  },
  {
    code: 'GONE',
    httpStatus: 410,
    description: 'Deprecated endpoint has been removed after its Sunset date',
    since: '1.1.0',
    retryable: false,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // V15-19 — the codes the gateway actually emits.
  //
  // The ten entries above mirrored the `ErrorCode` enum, and a test asserted exactly that
  // — so the registry was "exhaustive" against an enum while the wire carried 41 distinct
  // codes. Only seven overlapped. The single most-emitted code in the codebase,
  // `TENANT_REQUIRED` (424 emit sites), was absent, which means no client could branch on
  // the most common rejection the platform produces.
  //
  // `httpStatus` below is the status observed at the emit site, not a guess:
  // `tools/scripts/check-error-code-registry.mjs` re-derives both from source and fails
  // when a new code appears or a status drifts. That is what makes this a contract rather
  // than a list that goes stale again.
  // ───────────────────────────────────────────────────────────────────────────

  // Tenancy and entitlement
  {
    code: 'TENANT_REQUIRED',
    httpStatus: 400,
    description: 'Request could not be resolved to a tenant',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'TENANT_SUSPENDED',
    httpStatus: 403,
    description: 'Tenant is suspended; mutations and reads are refused',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'FEATURE_NOT_ENTITLED',
    httpStatus: 403,
    description: 'Tenant plan does not include the requested feature',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'INSTITUTION_OUT_OF_SCOPE',
    httpStatus: 403,
    description: 'Principal is not assigned to the requested institution',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'BOARD_FORBIDDEN',
    httpStatus: 403,
    description: 'Operation is not permitted for the tenant education board',
    since: '1.2.0',
    retryable: false,
  },

  // Authentication and session
  {
    code: 'AUTH_CONTEXT_REQUIRED',
    httpStatus: 400,
    description: 'Route requires an authenticated principal context that was not resolved',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'INVALID_CREDENTIALS',
    httpStatus: 401,
    description: 'Supplied credentials did not authenticate',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'ACCOUNT_LOCKED',
    httpStatus: 401,
    description: 'Account is locked after repeated failed attempts',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'ACCOUNT_INACTIVE',
    httpStatus: 401,
    description: 'Account exists but is not active',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'SESSION_EXPIRED',
    httpStatus: 401,
    description: 'Session is no longer valid and must be re-established',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'TOKEN_REVOKED',
    httpStatus: 401,
    description: 'Access token was revoked before its expiry',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'INVALID_REFRESH_TOKEN',
    httpStatus: 401,
    description: 'Refresh token is unknown, expired or already used',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'INVALID_API_KEY',
    httpStatus: 401,
    description: 'API key is unknown or revoked',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'USER_NOT_FOUND',
    httpStatus: 401,
    description: 'No user matched the authentication attempt',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'EMAIL_REQUIRED',
    httpStatus: 400,
    description: 'Identity provider returned no email claim',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'UNSUPPORTED_MFA_METHOD',
    httpStatus: 400,
    description: 'Requested multi-factor method is not enabled for this tenant',
    since: '1.2.0',
    retryable: false,
  },

  // Keycloak federation. Grouped because they share one cause class — the IdP exchange —
  // and a client's only sensible response to all of them is to restart the login.
  {
    code: 'KEYCLOAK_AUTH_ERROR',
    httpStatus: 401,
    description: 'Keycloak rejected the authentication attempt',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'KEYCLOAK_MISSING_CODE',
    httpStatus: 400,
    description: 'Authorization-code callback arrived without a code parameter',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'KEYCLOAK_TOKEN_EXCHANGE_FAILED',
    httpStatus: 401,
    description: 'Authorization code could not be exchanged for tokens',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'KEYCLOAK_MISSING_TICKET',
    httpStatus: 400,
    description: 'Ticket-based login was attempted without a ticket',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'KEYCLOAK_TICKET_INVALID',
    httpStatus: 401,
    description: 'Login ticket is unknown or expired',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'KEYCLOAK_MISSING_REFRESH',
    httpStatus: 400,
    description: 'Refresh was attempted without a refresh token',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'KEYCLOAK_REFRESH_FAILED',
    httpStatus: 401,
    description: 'Keycloak refused the refresh token',
    since: '1.2.0',
    retryable: false,
  },

  // Idempotency (W1-ARCH-03). Two of the three are retryable, and saying so is the whole
  // point: a client that treats IDEMPOTENCY_REPLAY_PENDING as terminal loses a mutation
  // that may already have applied.
  {
    code: 'IDEMPOTENCY_CONFLICT',
    httpStatus: 409,
    description: 'A request with this Idempotency-Key is already in flight',
    since: '1.2.0',
    retryable: true,
  },
  {
    code: 'IDEMPOTENCY_REPLAY_PENDING',
    httpStatus: 503,
    description:
      'Prior mutation may have completed but its response was not durably recorded; retry with the same key',
    since: '1.2.0',
    retryable: true,
  },
  {
    code: 'IDEMPOTENCY_STORE_UNAVAILABLE',
    httpStatus: 503,
    description: 'Idempotency store is unavailable; the request was refused rather than duplicated',
    since: '1.2.0',
    retryable: true,
  },

  // Dependency and degradation
  {
    code: 'CIRCUIT_OPEN',
    httpStatus: 503,
    description: 'Upstream service circuit breaker is open',
    since: '1.2.0',
    retryable: true,
  },
  {
    code: 'AUDIT_UNAVAILABLE',
    httpStatus: 503,
    description: 'Audit trail unavailable; a security-sensitive mutation was not acknowledged',
    since: '1.2.0',
    retryable: true,
  },
  {
    code: 'OFFERS_UNAVAILABLE',
    httpStatus: 503,
    description: 'Admission offer service is temporarily unavailable',
    since: '1.2.0',
    retryable: true,
  },
  {
    code: 'PUBLIC_REGISTRATION_CONTEXT_UNAVAILABLE',
    httpStatus: 503,
    description: 'Public registration context could not be loaded',
    since: '1.2.0',
    retryable: true,
  },

  // Resource shape
  {
    code: 'PUBLIC_REGISTRATION_CONTEXT_NOT_FOUND',
    httpStatus: 404,
    description: 'No public registration context exists for this host or slug',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'FORM_CONFIGURATION_NOT_FOUND',
    httpStatus: 404,
    description: 'Requested form configuration does not exist for this tenant',
    since: '1.2.0',
    retryable: false,
  },

  // Produced by `error-handler.ts` as `error.code || 'APP_ERROR'`. Registered rather than
  // waived: a value that can reach a client is part of the contract whether or not it was
  // meant to be, and a client switching on codes needs it to mean something.
  {
    code: 'APP_ERROR',
    httpStatus: 500,
    description: 'Application error raised without a specific code',
    since: '1.2.0',
    retryable: false,
  },

  // Uploads
  {
    code: 'FILE_REQUIRED',
    httpStatus: 400,
    description: 'Multipart request carried no file part',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'FILE_TOO_LARGE',
    httpStatus: 400,
    description: 'Uploaded file exceeds the configured size limit',
    since: '1.2.0',
    retryable: false,
  },
  {
    code: 'INVALID_FILE_TYPE',
    httpStatus: 400,
    description: 'Uploaded file type is not accepted for this endpoint',
    since: '1.2.0',
    retryable: false,
  },
] as const;

export function getErrorCodeDefinition(code: string): ErrorCodeDefinition | undefined {
  return ERROR_CODE_REGISTRY.find((e) => e.code === code);
}

export interface DeprecationPolicy {
  /** RFC 8594 Deprecation header value (HTTP-date or boolean true). */
  deprecation: string;
  /** RFC 8594 Sunset header (HTTP-date). */
  sunset: string;
  /** Successor link relation target (absolute or relative URI). */
  successor?: string;
  /** Human-readable migration note. */
  note?: string;
}

/**
 * W2-API-03: apply standard deprecation headers.
 * Call from route handlers that remain temporarily for compatibility.
 */
export function applyDeprecationHeaders(
  headers: { setHeader(name: string, value: string): void },
  policy: DeprecationPolicy,
): void {
  headers.setHeader('Deprecation', policy.deprecation);
  headers.setHeader('Sunset', policy.sunset);
  if (policy.successor) {
    headers.setHeader('Link', `<${policy.successor}>; rel="successor-version"`);
  }
  if (policy.note) {
    headers.setHeader('X-API-Deprecation-Note', policy.note);
  }
}

/** Default sunset window for newly deprecated routes (180 days). */
export function defaultSunsetDate(from = new Date()): string {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + 180);
  return d.toUTCString();
}
