import { describe, expect, it } from 'vitest';
import { gatewaySimulationAllowed, isGatewaySimulationRequested } from './gateway-simulation';

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe('gateway simulation switch (PRC-L243)', () => {
  it('is ignored when NODE_ENV=production even with the env var set', () => {
    const prod = env({ NODE_ENV: 'production', E2E_ALLOW_GATEWAY_SIMULATION: '1' });
    expect(gatewaySimulationAllowed(prod)).toBe(false);
    expect(isGatewaySimulationRequested('1', prod)).toBe(false);
  });

  it('is honoured outside production only when the env var and cookie are set', () => {
    const dev = env({ NODE_ENV: 'development', E2E_ALLOW_GATEWAY_SIMULATION: '1' });
    expect(isGatewaySimulationRequested('1', dev)).toBe(true);
    expect(isGatewaySimulationRequested(undefined, dev)).toBe(false);
    expect(isGatewaySimulationRequested('1', env({ NODE_ENV: 'development' }))).toBe(false);
  });
});
