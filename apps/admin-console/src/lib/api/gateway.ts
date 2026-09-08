/**
 * Server-side API gateway client for the Platform Admin Console.
 *
 * Forwards platform-admin requests through the API gateway. Always sets
 *  - `Authorization: Bearer <admin-jwt>`
 *  - `X-Tenant-ID: platform`
 *  - `X-Platform-Admin: true`
 *
 * The third header lets backend services apply elevated authorisation rules
 * (for example, allowing the tenant-service to list tenants beyond a single
 * tenant scope, or the plugin-service to approve marketplace submissions).
 */
import { cookies } from 'next/headers';

import { ADMIN_AUTH_COOKIES, decodeAdminToken } from '@/lib/auth';

/** Base URL for the API gateway. Can be overridden via env. */
export const GATEWAY_BASE_URL =
  process.env['NEXT_PUBLIC_GATEWAY_URL'] ?? process.env['GATEWAY_URL'] ?? 'http://localhost:3000';

/** API version prefix used by the gateway. */
export const GATEWAY_API_PREFIX = '/api/v1';

export interface GatewayRequestInit extends Omit<RequestInit, 'body'> {
  /** Optional structured body that will be JSON encoded. */
  json?: unknown;
  /** Raw body. Overrides `json` if both are provided. */
  body?: BodyInit | null;
  /** Tenant override for cross-tenant support tooling (default: 'platform'). */
  tenantId?: string;
  /** Whether to throw on non-2xx (default: false — return error envelope). */
  throwOnError?: boolean;
  /** Next.js fetch caching options. */
  next?: { revalidate?: number | false; tags?: string[] };
}

export interface GatewayResponse<T> {
  status: number;
  ok: boolean;
  data: T | null;
  error?: { code: string; message: string; details?: unknown };
}

/** Reads the current admin session token from cookies. */
export async function getAdminContext(): Promise<{
  accessToken: string | null;
  tenantId: string;
}> {
  const jar = await cookies();
  const accessToken = jar.get(ADMIN_AUTH_COOKIES.ACCESS_TOKEN)?.value ?? null;
  const payload = accessToken ? decodeAdminToken(accessToken) : null;
  const tenantId = payload?.tenantId ?? 'platform';
  return { accessToken, tenantId };
}

/**
 * Performs an authenticated platform-admin request against the API gateway.
 */
export async function gatewayFetch<T>(
  path: string,
  init: GatewayRequestInit = {},
): Promise<GatewayResponse<T>> {
  const { accessToken, tenantId: ctxTenantId } = await getAdminContext();
  const tenantId = init.tenantId ?? ctxTenantId;

  const headers = new Headers(init.headers);
  headers.set('X-Tenant-ID', tenantId);
  headers.set('X-Platform-Admin', 'true');
  headers.set('Accept', 'application/json');
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  let body: BodyInit | null | undefined = init.body;
  if (body == null && init.json !== undefined) {
    body = JSON.stringify(init.json);
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
  }

  const url = path.startsWith('http')
    ? path
    : `${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`;

  const fetchInit: RequestInit & { next?: GatewayRequestInit['next'] } = {
    ...init,
    method: init.method ?? (body ? 'POST' : 'GET'),
    headers,
    body: body ?? null,
  };
  if (init.next) fetchInit.next = init.next;

  let response: Response;
  try {
    response = await fetch(url, fetchInit);
  } catch (error) {
    const err = {
      code: 'NETWORK_ERROR',
      message: error instanceof Error ? error.message : 'Network error',
    };
    if (init.throwOnError) {
      throw new GatewayError({ status: 0, ...err });
    }
    return { status: 0, ok: false, data: null, error: err };
  }

  const contentType = response.headers.get('content-type') ?? '';
  let payload: unknown = null;
  if (response.status !== 204 && contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = isErrorPayload(payload)
      ? payload
      : {
          code: 'GATEWAY_ERROR',
          message: response.statusText || 'Gateway request failed',
        };
    if (init.throwOnError) {
      throw new GatewayError({
        status: response.status,
        code: error.code,
        message: error.message,
        details: payload,
      });
    }
    return {
      status: response.status,
      ok: false,
      data: null,
      error: { code: error.code, message: error.message, details: payload },
    };
  }

  return { status: response.status, ok: true, data: (payload as T) ?? null };
}

function isErrorPayload(value: unknown): value is { code: string; message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    typeof (value as { code: unknown }).code === 'string' &&
    typeof (value as { message: unknown }).message === 'string'
  );
}

export interface GatewayErrorInit {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

export class GatewayError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(init: GatewayErrorInit) {
    super(init.message);
    this.name = 'GatewayError';
    this.status = init.status;
    this.code = init.code;
    if (init.details !== undefined) this.details = init.details;
  }
}
