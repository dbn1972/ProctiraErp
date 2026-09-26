import { describe, expect, it } from 'vitest';

import { StatusBadge } from '@/components/ui/status-badge';
import { HOSTING_REGIONS } from '@/lib/hosting-regions';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import {
  accessTokenCookieOptions,
  clearCookieOptions,
  getAuthServiceUrl,
  refreshTokenCookieOptions,
} from '@/lib/auth/cookies';

describe('display helpers', () => {
  it('humanizes status text instead of relying on colour', () => {
    const cases: Array<[string, string]> = [
      ['healthy', 'success'],
      ['active', 'success'],
      ['approved', 'success'],
      ['pending_approval', 'warning'],
      ['submitted', 'warning'],
      ['in_review', 'warning'],
      ['provisioning', 'warning'],
      ['degraded', 'warning'],
      ['down', 'destructive'],
      ['revoked', 'destructive'],
      ['rejected', 'destructive'],
      ['denied', 'destructive'],
      ['failure', 'destructive'],
      ['expired', 'secondary'],
      ['archived', 'secondary'],
      ['disabled', 'secondary'],
      ['decommissioning', 'secondary'],
      ['suspended', 'secondary'],
      ['info_only', 'info'],
    ];

    for (const [status, variant] of cases) {
      const node = StatusBadge({ status, className: 'status' });
      expect(node.props.variant).toBe(variant);
      expect(node.props.className).toBe('status');
      expect(String(node.props.children)).toBe(
        status
          .split('_')
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' '),
      );
    }
  });

  it('formats dates and class names', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDate('')).toBe('—');
    expect(formatDateTime(new Date('2026-09-26T12:00:00.000Z'))).not.toBe('—');
    expect(formatDate('2026-09-26T12:00:00.000Z')).toMatch(/2026/);
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('lists the hosting regions the form is allowed to submit', () => {
    expect(HOSTING_REGIONS.map((region) => region.value)).toEqual([
      'us-east-1',
      'us-west-2',
      'eu-west-1',
    ]);
  });

  it('builds auth cookie options', () => {
    expect(accessTokenCookieOptions().httpOnly).toBe(true);
    expect(refreshTokenCookieOptions(10).maxAge).toBe(10);
    expect(clearCookieOptions().maxAge).toBe(0);
    expect(getAuthServiceUrl()).toMatch(/^http/);
  });
});
