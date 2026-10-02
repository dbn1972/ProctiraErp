/**
 * PRC-L059 — transport fee band: server-side distance/amount validation and
 * explicit "not linked to Fees" state.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const createTransportFeeStructure = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/transport/api', async (orig) => ({
  ...(await orig<object>()),
  createTransportFeeStructure,
}));

import { createTransportFeeStructureAction } from '../actions';
import { FeesPanel } from './fees-panel';

const base = { name: 'Band A', amountCents: 150_000, currency: 'INR' };

beforeEach(() => createTransportFeeStructure.mockReset());

describe('createTransportFeeStructureAction (PRC-L059)', () => {
  it('rejects max distance below min distance without calling the API', async () => {
    const result = await createTransportFeeStructureAction({
      ...base,
      minDistanceKm: 10,
      maxDistanceKm: 2,
    });
    expect(result.status).toBe('error');
    expect(result.message).toMatch(/Max distance/);
    expect(createTransportFeeStructure).not.toHaveBeenCalled();
  });

  it('rejects an amount above the cap', async () => {
    const result = await createTransportFeeStructureAction({
      ...base,
      amountCents: 100_000_001,
    });
    expect(result.status).toBe('error');
    expect(createTransportFeeStructure).not.toHaveBeenCalled();
  });

  it('warns when the created band is not linked to Fees', async () => {
    createTransportFeeStructure.mockResolvedValue({ id: 'b1', feesStructureId: null });
    const result = await createTransportFeeStructureAction({
      ...base,
      minDistanceKm: 0,
      maxDistanceKm: 5,
    });
    expect(result.status).toBe('success');
    expect(result.message).toMatch(/not linked to Fees/);
  });
});

describe('FeesPanel (PRC-L059)', () => {
  it('flags unlinked bands explicitly', () => {
    render(
      <FeesPanel
        routes={[]}
        stops={[]}
        links={[]}
        bands={[
          {
            id: 'b1',
            name: 'Band A',
            routeId: null,
            stopId: null,
            minDistanceKm: 0,
            maxDistanceKm: 5,
            amountCents: 150_000,
            currency: 'INR',
            feesStructureId: null,
          },
        ]}
      />,
    );
    expect(screen.getByTestId('transport-fee-band-unlinked')).toHaveTextContent(
      /Not linked to Fees/,
    );
  });
});
