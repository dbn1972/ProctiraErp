import { describe, it, expect } from 'vitest';
import { RedactedSecret, redact, isRedactedSecret } from './redacted-secret.js';

describe('RedactedSecret', () => {
  it('should expose the original value via expose()', () => {
    const secret = new RedactedSecret('my-secret-value');
    expect(secret.expose()).toBe('my-secret-value');
  });

  it('should return [REDACTED] from toString()', () => {
    const secret = new RedactedSecret('my-secret-value');
    expect(secret.toString()).toBe('[REDACTED]');
    expect(`${secret}`).toBe('[REDACTED]');
  });

  it('should return [REDACTED] from toJSON()', () => {
    const secret = new RedactedSecret('my-secret-value');
    expect(JSON.stringify({ secret })).toBe('{"secret":"[REDACTED]"}');
  });

  it('should return [REDACTED] from Node.js inspect', () => {
    const secret = new RedactedSecret('my-secret-value');
    const inspectSymbol = Symbol.for('nodejs.util.inspect.custom');
    expect((secret as Record<symbol, () => string>)[inspectSymbol]()).toBe('[REDACTED]');
  });

  it('should report correct length without exposing value', () => {
    const secret = new RedactedSecret('12345');
    expect(secret.length).toBe(5);
  });

  it('should report isEmpty correctly', () => {
    expect(new RedactedSecret('').isEmpty).toBe(true);
    expect(new RedactedSecret('x').isEmpty).toBe(false);
  });

  it('should not leak value when concatenated with strings', () => {
    const secret = new RedactedSecret('password123');
    const result = 'Value: ' + secret;
    expect(result).toBe('Value: [REDACTED]');
    expect(result).not.toContain('password123');
  });

  it('should not leak value when included in an array and serialized', () => {
    const secret = new RedactedSecret('password123');
    const arr = [secret];
    const serialized = JSON.stringify(arr);
    expect(serialized).not.toContain('password123');
    expect(serialized).toContain('[REDACTED]');
  });
});

describe('redact()', () => {
  it('should create a RedactedSecret instance', () => {
    const secret = redact('test-value');
    expect(secret).toBeInstanceOf(RedactedSecret);
    expect(secret.expose()).toBe('test-value');
  });
});

describe('isRedactedSecret()', () => {
  it('should return true for RedactedSecret instances', () => {
    expect(isRedactedSecret(new RedactedSecret('x'))).toBe(true);
    expect(isRedactedSecret(redact('x'))).toBe(true);
  });

  it('should return false for non-RedactedSecret values', () => {
    expect(isRedactedSecret('string')).toBe(false);
    expect(isRedactedSecret(123)).toBe(false);
    expect(isRedactedSecret(null)).toBe(false);
    expect(isRedactedSecret(undefined)).toBe(false);
    expect(isRedactedSecret({})).toBe(false);
  });
});
