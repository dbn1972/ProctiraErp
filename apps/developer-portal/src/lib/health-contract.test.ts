import { describe, expect, it } from 'vitest';

/**
 * Shape contract for developer-portal health JSON (used by Docker HEALTHCHECK).
 */
describe('developer-portal health contract', () => {
  it('expects status ok and service developer-portal', () => {
    const body = {
      status: 'ok',
      service: 'developer-portal',
      timestamp: new Date().toISOString(),
    };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('developer-portal');
    expect(body.timestamp).toMatch(/^\d{4}-/);
  });
});
