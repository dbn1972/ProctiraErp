import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InstitutionBreadcrumbLabel } from './institution-breadcrumb-label';
import { clearEntityLabelCache } from './use-entity-label';

const ID = '11111111-1111-4111-8111-111111111111';
function respond(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
}

describe('breadcrumb entity labels (PRC-L070)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    clearEntityLabelCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reflects a rename after revalidation instead of serving the cached name', async () => {
    fetchMock.mockReturnValueOnce(respond({ name: 'Old School' }));
    const first = render(<InstitutionBreadcrumbLabel institutionId={ID} fallbackLabel="1111…" />);
    expect(await screen.findByText('Old School')).toBeInTheDocument();
    first.unmount();

    fetchMock.mockReturnValueOnce(respond({ name: 'New School' }));
    render(<InstitutionBreadcrumbLabel institutionId={ID} fallbackLabel="1111…" />);
    expect(await screen.findByText('New School')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('evicts the cached name when the session can no longer read it', async () => {
    fetchMock.mockReturnValueOnce(respond({ name: 'Tenant A School' }));
    const first = render(<InstitutionBreadcrumbLabel institutionId={ID} fallbackLabel="1111…" />);
    expect(await screen.findByText('Tenant A School')).toBeInTheDocument();
    first.unmount();

    fetchMock.mockReturnValueOnce(respond({}, false));
    render(<InstitutionBreadcrumbLabel institutionId={ID} fallbackLabel="1111…" />);
    expect(await screen.findByText('1111…')).toBeInTheDocument();
    expect(screen.queryByText('Tenant A School')).not.toBeInTheDocument();
  });
});
