import { redirect } from 'next/navigation';

interface OAuthCallbackPageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

/**
 * /oauth/callback page.
 *
 * The actual token exchange is handled by the API route at
 * /api/auth/oauth/callback. This page simply forwards the OAuth provider's
 * callback (which lands here with `code`, `state`, etc.) to the route
 * handler that performs the token exchange and sets the cookies, then
 * redirects to `returnTo`.
 *
 * This indirection lets the OAuth provider's "Authorized redirect URI" be a
 * stable, user-readable path that does not include `/api/...`.
 */
export default function OAuthCallbackPage({ searchParams }: OAuthCallbackPageProps): JSX.Element {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === 'string') {
      params.set(key, value);
    } else if (Array.isArray(value) && value.length > 0) {
      params.set(key, value[0]!);
    }
  }
  redirect(`/api/auth/oauth/callback?${params.toString()}`);
}
