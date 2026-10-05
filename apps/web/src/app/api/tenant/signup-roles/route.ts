import { NextResponse } from 'next/server';
import { resolveTenantForRequest, TENANT_UNRESOLVED_BODY } from '@/lib/api/request-tenant';

/**
 * GET /api/tenant/signup-roles
 *
 * Proxy to the upstream Tenant Service `GET /api/v1/tenant/signup-roles`
 * (Design §D, Requirement 4 AC 17). The endpoint is public — the
 * sign-up screen is anonymous-accessible — so this route forwards the
 * tenant header but does not require an access token.
 *
 * PRC-M057: there is no synthetic fallback catalog. When the tenant service
 * is unreachable or returns no roles the route answers 503 so the sign-up
 * form shows an error instead of offering a hard-coded (privileged) list.
 */

interface SignupRole {
  id: string;
  label: string;
  description?: string;
  requiresApproval?: boolean;
}

const CATALOG_UNAVAILABLE = {
  roles: [] as SignupRole[],
  code: 'SIGNUP_ROLES_UNAVAILABLE',
  message: 'Sign-up roles are unavailable right now. Please try again later.',
};

function getTenantServiceUrl(): string {
  return (
    process.env['TENANT_SERVICE_URL'] ||
    process.env['NEXT_PUBLIC_GATEWAY_URL'] ||
    'http://localhost:3000'
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  // PRC-H027: tenant comes from the Host, never from a client header.
  const tenantId = resolveTenantForRequest(request);
  if (!tenantId) {
    return NextResponse.json(TENANT_UNRESOLVED_BODY, { status: 400 });
  }

  try {
    const upstream = await fetch(`${getTenantServiceUrl()}/api/v1/tenant/signup-roles`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Tenant-ID': tenantId,
      },
      // Roles change rarely — let Next cache for a minute so the public
      // sign-up screen does not hammer the tenant service on each visit.
      next: { revalidate: 60 },
    });

    if (!upstream.ok) {
      return NextResponse.json(CATALOG_UNAVAILABLE, { status: 503 });
    }

    const payload = (await safeJson(upstream)) as { roles?: SignupRole[] };
    if (!Array.isArray(payload.roles) || payload.roles.length === 0) {
      return NextResponse.json(CATALOG_UNAVAILABLE, { status: 503 });
    }
    return NextResponse.json({ roles: payload.roles });
  } catch {
    return NextResponse.json(CATALOG_UNAVAILABLE, { status: 503 });
  }
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}
