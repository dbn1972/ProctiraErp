/**
 * Test helper (PRC-M500): OIDC callbacks require the browser transaction cookie + state minted
 * by GET /login. Returns an inject() request for `/callback?code=...` bound to that login.
 */
import type { FastifyInstance } from 'fastify';

export async function boundCallbackRequest(
  app: FastifyInstance,
  code = 'abc',
): Promise<{ method: 'GET'; url: string; headers: { cookie: string } }> {
  const res = await app.inject({ method: 'GET', url: '/api/v1/auth/login' });
  const cookie = String(res.headers['set-cookie']).split(';')[0]!;
  const state = new URL(String(res.headers.location)).searchParams.get('state')!;
  return {
    method: 'GET',
    url: `/api/v1/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    headers: { cookie },
  };
}
