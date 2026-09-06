import { describe, expect, it } from 'vitest';

import { getInstallDocsUrl, getInstallSupportUrl, getWebAppLoginUrl } from './site';

describe('install wizard site helpers', () => {
  it('returns non-hash docs and support defaults', () => {
    expect(getInstallDocsUrl()).not.toMatch(/^#/);
    expect(getInstallSupportUrl()).not.toMatch(/^#/);
  });

  it('does not fall back to an in-wizard /login route', () => {
    expect(getWebAppLoginUrl()).not.toBe('/login');
  });
});
