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
