/**
 * @vitest-environment jsdom
 *
 * TenantIdentityBlock — component tests (Task 11.1 / Req 1 AC1-AC6).
 *
 * `TenantIdentityBlock` is an async Server Component, so it is exercised
 * the same way other async Server Components in this repo are tested
 * (see `apps/web/src/app/(parent)/parent/sunrise-screens.test.tsx`):
 * call it directly as an async function and render the resolved element
 * tree with `render(await TenantIdentityBlock({...}))`.
 *
 * `getTenantSettings()` calls `gatewayFetch`, which depends on
 * `next/headers` transitively — it cannot run unmocked in a unit test, so
 * `@/lib/api/admin.server` is mocked for every case below.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TenantIdentityBlock } from './TenantIdentityBlock';

const getTenantSettings = vi.fn();
vi.mock('@/lib/api/admin.server', () => ({
  getTenantSettings: (...args: unknown[]) => getTenantSettings(...args),
}));

beforeEach(() => {
  getTenantSettings.mockReset();
});

describe('<TenantIdentityBlock>', () => {
  it('renders nothing when getTenantSettings() returns no settings', async () => {
    getTenantSettings.mockResolvedValue({ settings: null, source: 'scaffold' });

    const { container } = render(await TenantIdentityBlock({ studentCount: 240 }));

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('tenant-identity-block')).toBeNull();
  });

  it('renders nothing when displayName is empty', async () => {
    getTenantSettings.mockResolvedValue({
      settings: { tenantId: 't-1', displayName: '' },
      source: 'gateway',
    });

    const { container } = render(await TenantIdentityBlock({ studentCount: 240 }));

    expect(container).toBeEmptyDOMElement();
  });

  it('renders the tenant display name when settings exist', async () => {
    getTenantSettings.mockResolvedValue({
      settings: { tenantId: 't-1', displayName: 'Sunrise Public School' },
      source: 'gateway',
    });

    render(await TenantIdentityBlock({ studentCount: 240 }));

    expect(screen.getByTestId('tenant-identity-block')).toBeTruthy();
    expect(screen.getByText('Sunrise Public School')).toBeInTheDocument();
  });

  it('renders the studentCount prop somewhere in the output', async () => {
    getTenantSettings.mockResolvedValue({
      settings: { tenantId: 't-1', displayName: 'Sunrise Public School' },
      source: 'gateway',
    });

    render(await TenantIdentityBlock({ studentCount: 1240 }));

    // en-IN grouping, matching the existing KPI card's formatCount().
    expect(screen.getByText('1,240 students')).toBeInTheDocument();
  });

  it('singularizes the headcount label for exactly one student', async () => {
    getTenantSettings.mockResolvedValue({
      settings: { tenantId: 't-1', displayName: 'Sunrise Public School' },
      source: 'gateway',
    });

    render(await TenantIdentityBlock({ studentCount: 1 }));

    expect(screen.getByText('1 student')).toBeInTheDocument();
  });

  it('omits the headcount line (but still renders the tenant name) when studentCount is null', async () => {
    getTenantSettings.mockResolvedValue({
      settings: { tenantId: 't-1', displayName: 'Sunrise Public School' },
      source: 'gateway',
    });

    render(await TenantIdentityBlock({ studentCount: null }));

    expect(screen.getByText('Sunrise Public School')).toBeInTheDocument();
    expect(screen.queryByText(/students?$/)).toBeNull();
  });
});
