import { describe, expect, it } from 'vitest';
import { buildHealthReport } from './health';

const now = () => new Date('2026-01-01T00:00:00.000Z');

describe('public-website health', () => {
  it('is degraded in production without CONTACT_WEBHOOK_URL', () => {
    const report = buildHealthReport({ NODE_ENV: 'production' }, now);
    expect(report.status).toBe('degraded');
    expect(report.checks.contactSink).toBe('missing');
  });
  it('is degraded in production with a non-https webhook', () => {
    const report = buildHealthReport(
      { NODE_ENV: 'production', CONTACT_WEBHOOK_URL: 'http://crm.internal/hook' },
      now,
    );
    expect(report.status).toBe('degraded');
    expect(report.checks.contactSink).toBe('invalid');
  });
  it('is ok in production with an https sink and never echoes the URL', () => {
    const report = buildHealthReport(
      {
        NODE_ENV: 'production',
        CONTACT_WEBHOOK_URL: 'https://crm.example/hook?token=secret',
        STATUS_PROBE_WEB_URL: 'http://web:3001/api/health',
      },
      now,
    );
    expect(report.status).toBe('ok');
    expect(report.checks).toEqual({ contactSink: 'configured', statusProbes: 'configured' });
    expect(JSON.stringify(report)).not.toContain('secret');
  });
  it('stays ok outside production even without a sink', () => {
    expect(buildHealthReport({ NODE_ENV: 'development' }, now).status).toBe('ok');
  });
});
