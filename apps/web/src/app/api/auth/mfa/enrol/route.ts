import { NextResponse, type NextRequest } from 'next/server';
import { getGatewayUrl } from '@/lib/auth/cookies';
import { MFA_ENROLMENT_RETURN_PATH, mfaEnrolmentProvider } from '@/lib/auth/mfa-provider';
import { AUTH_COOKIES } from '@/lib/auth/session';

/**
 * GET /api/auth/mfa/enrol
 *
 * PRC-H019 — starts Keycloak's OTP enrolment (application-initiated action
 * `CONFIGURE_TOTP`) through the gateway's PKCE login. Keycloak renders the QR
 * code, verifies the first TOTP and stores the credential; the gateway
 * callback then returns the browser to the web app. Signed-out callers are
 * sent to sign in first. Only available with the Keycloak provider.
 */
export function GET(request: NextRequest): NextResponse {
  if (mfaEnrolmentProvider() !== 'keycloak') {
    return NextResponse.json(
      { message: 'MFA enrolment is handled by the configured auth service.' },
      { status: 404 },
    );
  }
  if (!request.cookies.get(AUTH_COOKIES.ACCESS_TOKEN)?.value) {
    const login = new URL('/login', request.nextUrl.origin);
    login.searchParams.set('returnTo', '/mfa-setup');
    return NextResponse.redirect(login);
  }
  const gateway = new URL('/api/v1/auth/login', getGatewayUrl());
  gateway.searchParams.set('kc_action', 'CONFIGURE_TOTP');
  gateway.searchParams.set('state', `web:${MFA_ENROLMENT_RETURN_PATH}`);
  return NextResponse.redirect(gateway);
}
