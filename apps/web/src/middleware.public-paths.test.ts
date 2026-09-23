/**
 * @vitest-environment node
 *
 * The app's public surface, asserted by driving the real `middleware()`.
 *
 * ## Why this file exists
 *
 * `middleware.test.ts` covers the pure helpers extracted from the middleware —
 * `resolveTenantFromSubdomain`, `getTenantConfig` — and never invokes `middleware()`.
 * So nothing pinned which paths an anonymous visitor can reach, and adding a `page.tsx`
 * looked like it made a route reachable when it did not.
 *
 * That is not hypothetical. `/legal/privacy` and `/legal/terms` were added as routes to fix
 * the signup consent links, and because `/legal` was absent from `PUBLIC_PATHS` the 404
 * simply became a 307 to `/login?returnTo=/legal/privacy`. The user still could not open
 * the terms they were being asked to accept — the same defect with a different status code,
 * and the page-level tests could not see it because a route existing and a route being
 * reachable are different properties.
 */
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { middleware } from './middleware';

function get(path: string, cookies: Record<string, string> = {}): NextRequest {
  const request = new NextRequest(`http://localhost:3001${path}`);
  for (const [name, value] of Object.entries(cookies)) {
    request.cookies.set(name, value);
  }
  return request;
}

/** Paths an anonymous visitor must be able to reach. */
const PUBLIC = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/track',
  '/track/REG-ABC123',
  // Read before a session exists, by definition.
  '/legal/privacy',
  '/legal/terms',
];

describe('middleware public surface', () => {
  for (const path of PUBLIC) {
    it(`lets an anonymous visitor reach ${path}`, async () => {
      const response = await middleware(get(path));
      // `NextResponse.next()` is a 200; a redirect to /login is a 307.
      expect(response.status, `${path} redirected to ${response.headers.get('location')}`).toBe(
        200,
      );
      expect(response.headers.get('location')).toBeNull();
    });
  }

  it('still gates an authenticated route', async () => {
    // The complement: if everything were public this suite would be meaningless.
    const response = await middleware(get('/students'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login');
  });

  it('sends the consent documents to the user, not to the login page', async () => {
    // Named separately because it is the specific journey that was broken: the signup form
    // links to both, so a redirect here means consent cannot be informed.
    for (const path of ['/legal/terms', '/legal/privacy']) {
      const response = await middleware(get(path));
      expect(response.headers.get('location'), path).toBeNull();
    }
  });
});
