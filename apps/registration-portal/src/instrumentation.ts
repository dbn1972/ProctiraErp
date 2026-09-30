/**
 * Next.js boot hook: fail fast when the gateway base URL is missing in
 * production instead of serving a portal whose data calls cannot work.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { getGatewayApiBaseUrl } = await import('./lib/gateway-config');
  getGatewayApiBaseUrl();
}
