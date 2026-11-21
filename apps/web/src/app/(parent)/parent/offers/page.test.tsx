/**
 * D1-T2: a failed offers read shows fixed copy and the gateway reference, never the server text.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ listGuardianOffers: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ requireSession: vi.fn(async () => ({ user: {} })) }));
vi.mock('@/lib/api/parent-portal', () => ({ listGuardianOffers: m.listGuardianOffers }));
vi.mock('./_components/accept-offer-form', () => ({
  AcceptOfferForm: () => null,
  OfferFeeLine: () => null,
}));
import { GatewayError } from '@/lib/api/gateway';
import ParentOffersPage from './page';
describe('ParentOffersPage load failure (D1-T2)', () => {
  it('shows fixed copy and the reference id', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    m.listGuardianOffers.mockRejectedValue(
      new GatewayError({
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'column "offer_fee_cents" does not exist',
        correlationId: 'corr-5b1e0c2a',
      }),
    );
    const html = renderToStaticMarkup(await ParentOffersPage());
    expect(html).toContain('Unable to load your offers. Try again later.');
    expect(html).toContain('Reference: corr-5b1e0c2a');
    expect(html).not.toContain('offer_fee_cents');
    spy.mockRestore();
  });
});
