import { describe, expect, it } from 'vitest';

import { validateAdminAccount } from './admin-validation';

const valid = {
  email: 'admin@example.edu',
  password: 'Securepass1',
  confirmPassword: 'Securepass1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  tenantName: 'Demo District',
  tenantSlug: 'demo-district',
};

describe('validateAdminAccount', () => {
  it('accepts a well-formed payload', () => {
    expect(validateAdminAccount(valid)).toBeNull();
  });

  it('rejects missing or invalid email', () => {
    expect(validateAdminAccount({ ...valid, email: '' })?.email).toMatch(/required/i);
    expect(validateAdminAccount({ ...valid, email: 'bad' })?.email).toMatch(/invalid/i);
  });

  it('rejects short passwords, weak complexity, and mismatches', () => {
    expect(validateAdminAccount({ ...valid, password: 'short' })?.password).toMatch(/8/i);
    expect(
      validateAdminAccount({ ...valid, password: 'longenough', confirmPassword: 'longenough' })
        ?.password,
    ).toMatch(/letter and one number/i);
    expect(validateAdminAccount({ ...valid, confirmPassword: 'other' })?.confirmPassword).toMatch(
      /match/i,
    );
  });

  it('rejects invalid tenant slug', () => {
    expect(validateAdminAccount({ ...valid, tenantSlug: 'Bad Slug' })?.tenantSlug).toMatch(
      /lowercase/i,
    );
  });
});
