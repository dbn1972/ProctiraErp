import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * PRC-M029: the developer-portal landing page must not advertise capabilities
 * that do not exist (240+ endpoints, /v3 API, GitHub sign-in, self-serve
 * sandbox tenants presented as available, downtime-free key rotation).
 */
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'page.tsx'), 'utf8');

describe('developer portal landing honesty (PRC-M029)', () => {
  it('does not claim a specific inflated endpoint count', () => {
    expect(source).not.toContain('240+');
  });

  it('does not advertise a non-existent /v3 API', () => {
    expect(source).not.toContain('/v3/');
    expect(source).not.toContain('API v3 is live');
  });

  it('does not offer GitHub sign-in', () => {
    expect(source).not.toContain('Sign in with GitHub');
    expect(source).not.toMatch(/GitHub or email/);
  });

  it('labels sandbox tenants as planned rather than self-serve', () => {
    expect(source).not.toContain('sandbox tenants now self-serve');
    expect(source).toMatch(/planned/i);
  });

  it('does not claim downtime-free key rotation', () => {
    expect(source).not.toContain('Keys rotate without downtime');
  });
});
