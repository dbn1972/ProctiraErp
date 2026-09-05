import { NextResponse } from 'next/server';
import {
  accessTokenCookieOptions,
  getAuthServiceUrl,
  refreshTokenCookieOptions,
} from '@/lib/auth/cookies';
import { sanitizeReturnTo } from '@/lib/auth/return-to';
import { AUTH_COOKIES } from '@/lib/auth/session';

/**
 * GET /api/auth/oauth/callback?code=...&state=...&provider=...
 *
 * Final leg of the OAuth/OIDC code-grant flow. We forward the authorization
 * code + state to the upstream auth-service which validates them, looks up
 * the user (creating one for first-time logins when configured), and returns
 * a token pair. The tokens are persisted as httpOnly cookies and the
 * browser is redirected to the original `returnTo` path.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const provider = url.searchParams.get('provider');
  const returnTo = sanitizeReturnTo(url.searchParams.get('returnTo'));
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    return redirectToLogin(request, {
      error: errorParam,
      returnTo,
    });
  }

  if (!code || !state || !provider) {
    return redirectToLogin(request, {
      error: 'invalid_callback',
      returnTo,
    });
  }

  const tenantId = request.headers.get('x-tenant-id') ?? 'default';

  let upstream: Response;
  try {
    upstream = await fetch(`${getAuthServiceUrl()}/auth/oauth/callback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': tenantId,
      },
      body: JSON.stringify({ code, state, provider }),
      cache: 'no-store',
    });
  } catch {
    return redirectToLogin(request, {
      error: 'auth_unavailable',
      returnTo,
    });
  }

  const data = (await safeJson(upstream)) as {
    tokens?: { accessToken: string; refreshToken: string; expiresIn: number };
    session?: { id: string };
    message?: string;
  };

  if (!upstream.ok || !data.tokens) {
    return redirectToLogin(request, {
      error: data.message || 'oauth_failed',
      returnTo,
    });
  }

  const destination = new URL(returnTo, request.url);
  const response = NextResponse.redirect(destination);
  response.cookies.set(
    AUTH_COOKIES.ACCESS_TOKEN,
    data.tokens.accessToken,
    accessTokenCookieOptions(data.tokens.expiresIn),
  );
  response.cookies.set(
    AUTH_COOKIES.REFRESH_TOKEN,
    data.tokens.refreshToken,
    refreshTokenCookieOptions(),
  );
  if (data.session?.id) {
    response.cookies.set(
      AUTH_COOKIES.SESSION_ID,
      data.session.id,
      accessTokenCookieOptions(),
    );
  }
  return response;
}

function redirectToLogin(
  request: Request,
  params: { error?: string; returnTo?: string },
): NextResponse {
  const loginUrl = new URL('/login', request.url);
  if (params.error) loginUrl.searchParams.set('error', params.error);
  if (params.returnTo) {
    loginUrl.searchParams.set(
      'returnTo',
      sanitizeReturnTo(params.returnTo),
    );
  }
  return NextResponse.redirect(loginUrl);
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}
