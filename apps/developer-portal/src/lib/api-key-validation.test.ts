import { describe, expect, it } from 'vitest';

import { validateApiKeyRequest } from './api-key-validation';

const valid = {
  name: 'Attendance sync',
  scope: 'students:read',
};

describe('validateApiKeyRequest', () => {
  it('accepts a well-formed payload', () => {
    expect(validateApiKeyRequest(valid)).toBeNull();
  });

  it('rejects short or empty names', () => {
    expect(validateApiKeyRequest({ ...valid, name: '' })?.name).toMatch(/required/i);
    expect(validateApiKeyRequest({ ...valid, name: 'ab' })?.name).toMatch(/3 characters/i);
  });

  it('rejects oversized or invalid names', () => {
    expect(validateApiKeyRequest({ ...valid, name: 'a'.repeat(65) })?.name).toMatch(
      /64 characters/i,
    );
    expect(validateApiKeyRequest({ ...valid, name: '-bad' })?.name).toMatch(/alphanumeric/i);
  });

  it('rejects consecutive spaces', () => {
    expect(validateApiKeyRequest({ ...valid, name: 'Bad  name' })?.name).toMatch(
      /consecutive spaces/i,
    );
  });

  it('rejects reserved names', () => {
    expect(validateApiKeyRequest({ ...valid, name: 'admin' })?.name).toMatch(/reserved/i);
    expect(validateApiKeyRequest({ ...valid, name: 'ROOT' })?.name).toMatch(/reserved/i);
  });

  it('rejects unknown scopes', () => {
    expect(validateApiKeyRequest({ ...valid, scope: 'admin:*' })?.scope).toMatch(/allowlist/i);
  });

  it('rejects non-string inputs', () => {
    expect(validateApiKeyRequest({ name: 12, scope: valid.scope })?.name).toMatch(/required/i);
    expect(validateApiKeyRequest({ name: valid.name, scope: null })?.scope).toMatch(/required/i);
  });
});
