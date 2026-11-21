/**
 * HL-O1: /health/screenings rendered a refused or failed read as "No screening programs
 * yet." with zero KPIs. It now shows the failure panel instead.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HealthScreeningsPage from './page';

const gatewayFetch = vi.fn();
vi.mock('@/lib/api/gateway', () => ({
  gatewayFetch: (...args: unknown[]) => gatewayFetch(...args),
  GatewayError: class GatewayError extends Error {},
}));
vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => ({
    user: { sub: 'c-1', roles: [{ roleName: 'counsellor' }] },
  })),
}));

beforeEach(() => {
  gatewayFetch.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('/health/screenings failed reads (HL-O1)', () => {
  it.each([
    [403, 'denied'],
    [500, 'unavailable'],
  ])('a %i shows the %s panel, not the empty programme table', async (status, kind) => {
    gatewayFetch.mockResolvedValue({ ok: false, status, data: null, error: { code: 'X' } });
    render(await HealthScreeningsPage());
    expect(screen.getByTestId('list-load-failure')).toHaveAttribute('data-failure-kind', kind);
    expect(screen.getByText(`Reference: HTTP ${status}`)).toBeInTheDocument();
    expect(screen.queryByText('No screening programs yet.')).toBeNull();
    expect(screen.queryByText('Programs')).toBeNull();
  });

  it('lists programmes on success', async () => {
    gatewayFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: [
          {
            id: 'sp-1',
            name: 'Vision check',
            gradeLevel: '5',
            assessmentTypes: ['vision'],
            scheduledDate: '2026-11-02',
            status: 'planned',
          },
        ],
        meta: { totalItems: 1 },
      },
    });
    render(await HealthScreeningsPage());
    expect(screen.getByText('Vision check')).toBeInTheDocument();
    expect(screen.getByText('1 screening program scheduled')).toBeInTheDocument();
  });
});
