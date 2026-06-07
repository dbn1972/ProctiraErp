import { NextResponse } from 'next/server';
import { getAuthServiceUrl } from '@/lib/auth/cookies';

/**
 * GET /api/auth/oauth/authorize?provider=google&returnTo=/dashboard
 *
 * Builds an upstream authorize URL and redirects the browser there. The
 * upstream auth-service is responsible for validating the provider and
 * generating the OAuth state + PKCE parameters, then redirecting to the
 * configured provider. The provider eventually calls back to /oauth/callback.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const provider = url.searchParams.get('provider');
  const returnTo = url.searchParams.get('returnTo') || '/';

  if (!provider) {
    return NextResponse.json(
      { message: 'OAuth provider is required.' },
      { status: 400 },
    );
  }

  // Build the upstream URL that returns a redirect to the provider.
  const upstream = new URL(`${getAuthServiceUrl()}/auth/oauth/authorize`);
  upstream.searchParams.set('provider', provider);
  upstream.searchParams.set('returnTo', returnTo);

  // Forward any tenant header through the redirect query param so the
  // auth-service can pick the correct tenant configuration.
  const tenantId = request.headers.get('x-tenant-id');
  if (tenantId) {
    upstream.searchParams.set('tenantId', tenantId);
  }

  return NextResponse.redirect(upstream);
}
