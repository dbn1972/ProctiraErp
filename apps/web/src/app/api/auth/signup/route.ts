import { NextResponse } from 'next/server';
import { scorePassword } from '@proctira/auth';
import { getAuthServiceUrl } from '@/lib/auth/cookies';

/**
 * POST /api/auth/signup
 *
 * Forwards the new-account creation request to the upstream Auth Service
 * (`POST /api/v1/auth/signup`). The same call atomically writes the
 * `auth_terms_acceptances` audit row required by Requirement 4 AC 15 —
 * the client supplies the `termsAcceptance` payload (timestamp, terms
 * version, privacy version) captured at the moment the user clicked the
 * acceptance checkbox, and the Auth Service stores the row keyed by the
 * newly issued user identifier (Design §D, "Terms acceptance audit
 * record schema").
 *
 * **Server-side weak-password rejection (Task 49.6 / Requirement 4 AC 14).**
 * Before forwarding the request upstream we run the candidate password
 * through the canonical `scorePassword()` helper from `@proctira/auth`
 * — the same algorithm that drives the `<PasswordStrengthMeter>` on
 * the Sign-Up screens. A `weak` rating is returned as `422
 * Unprocessable Entity` with `code: 'WEAK_PASSWORD'` so a hand-rolled
 * HTTP client cannot bypass the meter. The Auth Service is expected
 * to mirror the same check for defence in depth.
 *
 * Tenant resolution mirrors `/api/auth/login`: the `X-Tenant-ID` header
 * is forwarded from the middleware-resolved value so the upstream
 * service writes the new account into the correct tenant. The applicant's
 * IP address and User-Agent are forwarded as `X-Forwarded-For` and
 * `User-Agent` so the Auth Service can persist them on the audit row
 * without trusting client-supplied values.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: {
    fullName?: string;
    email?: string;
    password?: string;
    institutionName?: string;
    roleId?: string;
    termsAcceptance?: {
      acceptedAt?: string;
      termsVersion?: string;
      privacyVersion?: string;
    };
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Invalid request body.' }, { status: 400 });
  }

  const { fullName, email, password, institutionName, roleId, termsAcceptance } = body;

  if (!fullName || !email || !password || !institutionName || !roleId) {
    return NextResponse.json({ message: 'All fields are required.' }, { status: 400 });
  }

  // Requirement 4 AC 14 — reject `weak` passwords server-side using the
  // canonical scoring algorithm from `@proctira/auth`. The same helper
  // drives the `<PasswordStrengthMeter>` on Sign-Up so the gate here
  // is identical to what the user saw before submitting. Returning
  // 422 Unprocessable Entity (rather than 400) signals that the
  // request was syntactically valid but the password failed the
  // semantic policy check, and gives the client a stable
  // `code: 'WEAK_PASSWORD'` it can map to a translated error.
  if (scorePassword(password) === 'weak') {
    return NextResponse.json(
      {
        message:
          'Password is too weak. Use a longer password with mixed character types and avoid common patterns.',
        code: 'WEAK_PASSWORD',
      },
      { status: 422 },
    );
  }

  // Requirement 4 AC 15 — terms acceptance must be captured atomically with
  // account creation. Reject the request when the audit payload is missing
  // or incomplete to keep the audit trail consistent.
  if (
    !termsAcceptance ||
    !termsAcceptance.acceptedAt ||
    !termsAcceptance.termsVersion ||
    !termsAcceptance.privacyVersion
  ) {
    return NextResponse.json({ message: 'Terms acceptance is required.' }, { status: 400 });
  }

  const tenantId = request.headers.get('x-tenant-id') ?? 'default';
  const forwardedFor =
    request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? '';
  const userAgent = request.headers.get('user-agent') ?? '';

  let upstream: Response;
  try {
    upstream = await fetch(`${getAuthServiceUrl()}/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': tenantId,
        ...(forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {}),
        ...(userAgent ? { 'User-Agent': userAgent } : {}),
      },
      body: JSON.stringify({
        fullName,
        email,
        password,
        institutionName,
        roleId,
        termsAcceptance: {
          acceptedAt: termsAcceptance.acceptedAt,
          termsVersion: termsAcceptance.termsVersion,
          privacyVersion: termsAcceptance.privacyVersion,
          // Forwarded so the audit row matches the canonical schema
          // documented in design.md §D. The Auth Service is free to
          // overwrite these with values it observes server-side.
          ipAddress: forwardedFor || undefined,
          userAgent: userAgent || undefined,
        },
      }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      {
        message: 'The authentication service is currently unavailable. Please try again shortly.',
      },
      { status: 503 },
    );
  }

  const data = (await safeJson(upstream)) as {
    message?: string;
    code?: string;
    requiresApproval?: boolean;
    email?: string;
  };

  if (!upstream.ok) {
    return NextResponse.json(
      {
        message: data.message || 'We could not create your account.',
        code: data.code,
      },
      { status: upstream.status },
    );
  }

  return NextResponse.json({
    success: true,
    requiresApproval: Boolean(data.requiresApproval),
    email: data.email ?? email,
    message: data.message,
  });
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}
