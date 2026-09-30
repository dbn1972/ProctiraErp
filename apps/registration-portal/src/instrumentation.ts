/**
 * Next.js boot hook: fail fast when the gateway base URL is missing in
 * production instead of serving a portal whose data calls cannot work.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { getGatewayApiBaseUrl } = await import('./lib/gateway-config');
  try {
    getGatewayApiBaseUrl();
  } catch (error) {
    // Next only logs instrumentation errors and keeps the process alive; exit so
    // the orchestrator sees a failed start instead of a portal that cannot work.
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
