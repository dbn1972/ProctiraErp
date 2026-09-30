import { describe, expect, it } from 'vitest';
import { redactedRequestSerializer, redactUrlQuerySecrets } from './log-redaction.js';

describe('access-log redaction (PRC-L344)', () => {
  it('redacts download tokens from logged URLs', () => {
    const out = redactUrlQuerySecrets('/api/v1/scholarships/document-downloads?token=abc.def');
    expect(out).toBe('/api/v1/scholarships/document-downloads?token=%5BREDACTED%5D');
    expect(out).not.toContain('abc.def');
  });

  it('leaves URLs without secrets unchanged', () => {
    expect(redactUrlQuerySecrets('/api/v1/fees/invoices?page=2')).toBe(
      '/api/v1/fees/invoices?page=2',
    );
    expect(redactUrlQuerySecrets('/health')).toBe('/health');
  });

  it('serializer never emits the raw token', () => {
    const logged = redactedRequestSerializer({
      method: 'GET',
      url: '/api/v1/scholarships/document-downloads?token=secret-value&x=1',
      hostname: 'h',
      ip: '10.0.0.1',
    });
    expect(JSON.stringify(logged)).not.toContain('secret-value');
    expect(logged.url).toContain('x=1');
  });
});
