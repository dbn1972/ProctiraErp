import { describe, expect, it } from 'vitest';

import { routePathForAuthz } from './route-authz-path.js';

describe('routePathForAuthz', () => {
  it('prefers the matched route pattern over the raw request target', () => {
    expect(
      routePathForAuthz({
        url: '/api/v1/staff/%70ayroll/export?month=2026-09',
        routeOptions: { url: '/api/v1/staff/payroll/export' },
      }),
    ).toBe('/api/v1/staff/payroll/export');
  });

  it('falls back to the decoded, query-stripped path when no route matched', () => {
    expect(routePathForAuthz({ url: '/notifications/%73end?x=1' })).toBe('/notifications/send');
    expect(routePathForAuthz({ url: '/a/%E0%A4%A?x' })).toBe('/a/%E0%A4%A');
  });
});
