/**
 * Same-origin scholarship proxy.
 *
 * Client components cannot read the httpOnly access token, and the gateway
 * does not accept that cookie. This route attaches the session bearer and
 * forwards only under /api/v1/scholarships via the shared proxy helper
 * (PRC-M134: timeout + body cap + 502/504 error mapping).
 */
import { proxyToGateway } from '@/lib/api/gateway-proxy';

async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  return proxyToGateway(request, path, { prefix: 'scholarships', label: 'scholarship' });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
