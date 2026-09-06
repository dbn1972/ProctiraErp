import { describe, expect, it } from 'vitest';

import { isPublicPath } from './public-paths';

describe('isPublicPath', () => {
  it('allows login and forbidden', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/forbidden')).toBe(true);
    expect(isPublicPath('/forbidden/extra')).toBe(true);
  });

  it('allows auth API login/logout', () => {
    expect(isPublicPath('/api/auth/login')).toBe(true);
    expect(isPublicPath('/api/auth/logout')).toBe(true);
  });

  it('denies protected console routes', () => {
    expect(isPublicPath('/')).toBe(false);
    expect(isPublicPath('/tenants')).toBe(false);
    expect(isPublicPath('/break-glass/requests')).toBe(false);
    expect(isPublicPath('/audit')).toBe(false);
  });
});
