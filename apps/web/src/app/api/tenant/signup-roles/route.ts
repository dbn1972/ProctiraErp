import { NextResponse } from 'next/server';

/**
 * GET /api/tenant/signup-roles
 *
 * Proxy to the upstream Tenant Service `GET /api/v1/tenant/signup-roles`
 * (Design §D, Requirement 4 AC 17). The endpoint is public — the
 * sign-up screen is anonymous-accessible — so this route forwards the
 * tenant header but does not require an access token. When the upstream
 * service is unreachable the route falls back to a small default catalog
 * so the sign-up form still renders a usable role picker.
 */

interface SignupRole {
  id: string;
  label: string;
  description?: string;
  requiresApproval?: boolean;
}

const FALLBACK_ROLES: SignupRole[] = [
  { id: 'principal', label: 'Principal / Director', requiresApproval: true },
  { id: 'admin', label: 'School Administrator', requiresApproval: true },
  { id: 'teacher', label: 'Teacher', requiresApproval: true },
  { id: 'parent', label: 'Parent / Guardian', requiresApproval: false },
  { id: 'student', label: 'Student', requiresApproval: false },
];

function getTenantServiceUrl(): string {
  return (
    process.env['TENANT_SERVICE_URL'] ||
    process.env['NEXT_PUBLIC_GATEWAY_URL'] ||
    'http://localhost:3000'
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  const tenantId = request.headers.get('x-tenant-id') ?? 'default';

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
      return NextResponse.json({ roles: FALLBACK_ROLES });
    }

    const payload = (await safeJson(upstream)) as { roles?: SignupRole[] };
    const roles =
      Array.isArray(payload.roles) && payload.roles.length > 0 ? payload.roles : FALLBACK_ROLES;
    return NextResponse.json({ roles });
  } catch {
    return NextResponse.json({ roles: FALLBACK_ROLES });
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
