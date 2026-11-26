/**
 * PRC-L078: the dashboard layout wraps every route in a FeatureFlagsProvider
 * fed from the tenant's entitlements, so `useFeatureFlags()` stops returning the
 * hard-coded defaults for every tenant.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFeatureFlags } from '@/providers/FeatureFlagsProvider';

const getTenantFeatureFlags = vi.fn();
vi.mock('@/lib/api/entitlements', () => ({
  getTenantFeatureFlags: () => getTenantFeatureFlags(),
}));
vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => ({ user: { id: 'u1' } })),
}));
vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import DashboardLayout from './layout';

function FlagProbe() {
  const { isEnabled } = useFeatureFlags();
  return <span data-testid="flag">{String(isEnabled('legacy_mobile_routes'))}</span>;
}

beforeEach(() => {
  getTenantFeatureFlags.mockReset();
});

describe('DashboardLayout feature flags (PRC-L078)', () => {
  it('exposes the tenant entitlement value to useFeatureFlags()', async () => {
    getTenantFeatureFlags.mockResolvedValue({ legacy_mobile_routes: true });
    render(await DashboardLayout({ children: <FlagProbe /> }));
    expect(screen.getByTestId('flag')).toHaveTextContent('true');
  });

  it('keeps the default (off) when the tenant has no entitlement', async () => {
    getTenantFeatureFlags.mockResolvedValue({});
    render(await DashboardLayout({ children: <FlagProbe /> }));
    expect(screen.getByTestId('flag')).toHaveTextContent('false');
  });
});
