/**
 * Same-origin proxy for parent scholarship calls. Forwards under
 * /api/v1/parent-portal/scholarships with the session bearer via the shared
 * proxy helper (PRC-M134: timeout + body cap + 502/504 error mapping).
 */
import { proxyToGateway } from '@/lib/api/gateway-proxy';

async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  return proxyToGateway(request, path, {
    prefix: 'parent-portal/scholarships',
    label: 'scholarship',
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
