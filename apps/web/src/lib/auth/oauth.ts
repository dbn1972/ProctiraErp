/** Builds the OAuth authorize URL used by federated sign-in buttons. */
export function buildOAuthHref(provider: string, returnTo = '/'): string {
  const params = new URLSearchParams({ provider });
  if (returnTo) params.set('returnTo', returnTo);
  return `/api/auth/oauth/authorize?${params.toString()}`;
}
