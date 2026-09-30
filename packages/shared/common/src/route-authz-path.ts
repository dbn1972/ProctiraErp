/**
 * Path used to choose a route's RBAC action.
 *
 * Domain guards that classify the action from the path (staff vs portal, publish vs update,
 * public vs staff) must use the *matched route pattern*, not the raw request target. Fastify
 * routes on the percent-decoded path, so `/staff/%70ayroll/export` reaches the `payroll` handler
 * while a regex over `request.url` sees no `payroll` segment and picks a weaker action
 * (PRC-H088 and the same pattern in other domains).
 *
 * `routeOptions.url` is the registered pattern including any register() prefix, e.g.
 * `/api/v1/communication/circulars/:id/ack`. It is only absent when no route matched, in which
 * case no handler runs; we then fall back to the query-stripped, decoded request path.
 */
export interface RouteAuthzRequestLike {
  url: string;
  routeOptions?: { url?: string };
}

export function routePathForAuthz(request: RouteAuthzRequestLike): string {
  const pattern = request.routeOptions?.url;
  if (typeof pattern === 'string' && pattern.length > 0) return pattern;
  const raw = request.url.split('?')[0] ?? request.url;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
