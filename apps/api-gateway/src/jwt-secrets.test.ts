import { describe, it, expect } from 'vitest';
import {
  loadJwtSecretPair,
  secretForKid,
  verifySecretCandidates,
} from './jwt-secrets.js';

describe('G-504 JWT dual-secret helpers', () => {
  it('loads current + previous from env', () => {
    const pair = loadJwtSecretPair({
      JWT_SECRET: 'new-secret',
      JWT_SECRET_PREVIOUS: 'old-secret',
      NODE_ENV: 'test',
    });
    expect(pair.current).toBe('new-secret');
    expect(pair.previous).toBe('old-secret');
    expect(secretForKid(pair, 'current')).toBe('new-secret');
    expect(secretForKid(pair, 'previous')).toBe('old-secret');
    expect(verifySecretCandidates(pair)).toEqual(['new-secret', 'old-secret']);
  });

  it('ignores previous when identical to current', () => {
    const pair = loadJwtSecretPair({
      JWT_SECRET: 'same',
      JWT_SECRET_PREVIOUS: 'same',
      NODE_ENV: 'test',
    });
    expect(pair.previous).toBeUndefined();
    expect(verifySecretCandidates(pair)).toEqual(['same']);
  });

  it('defaults kid labels', () => {
    const pair = loadJwtSecretPair({
      JWT_SECRET: 's',
      NODE_ENV: 'test',
    });
    expect(pair.currentKid).toBe('current');
    expect(pair.previousKid).toBe('previous');
  });
});
