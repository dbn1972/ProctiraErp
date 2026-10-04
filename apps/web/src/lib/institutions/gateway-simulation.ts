/**
 * Test-only gateway-down simulation switch for the institution detail layout.
 *
 * The e2e suite (16f) can force the "gateway unavailable" chrome by starting
 * the web server with `E2E_ALLOW_GATEWAY_SIMULATION=1` and sending the
 * `e2e-gateway-down=1` cookie. That switch must never be honoured by a
 * production build, even if the env var leaks into a deployment.
 */
export function gatewaySimulationAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  return env.E2E_ALLOW_GATEWAY_SIMULATION === '1';
}

export function isGatewaySimulationRequested(
  cookieValue: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return gatewaySimulationAllowed(env) && cookieValue === '1';
}
