/**
 * PRC-H021 — a failed or denied health read must not render as "None recorded".
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HealthRecordPage from './page';

const gatewayFetch = vi.fn();
vi.mock('@/lib/api/gateway', () => ({
  gatewayFetch: (...args: unknown[]) => gatewayFetch(...args),
  GatewayError: class GatewayError extends Error {},
}));
vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => ({ user: { sub: 'nurse-1', roles: [{ roleName: 'nurse' }] } })),
}));
const getStudent = vi.fn();
vi.mock('@/lib/api/students', () => ({ getStudent: (...a: unknown[]) => getStudent(...a) }));
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
vi.mock('next/navigation', () => ({ notFound: () => notFound() }));

const STUDENT = '00000000-0000-4000-8000-0000000000aa';

function respond(byPath: Record<string, { ok: boolean; status: number; data: unknown }>) {
  gatewayFetch.mockImplementation(async (path: string) => {
    const hit = Object.entries(byPath).find(([prefix]) => path.startsWith(prefix));
    return hit
      ? { ...hit[1], error: hit[1].ok ? undefined : { code: 'X' } }
      : { ok: false, status: 404, data: null };
  });
}

async function renderPage() {
  render(await HealthRecordPage({ params: Promise.resolve({ studentId: STUDENT }) }));
}

describe('health record detail page (PRC-H021)', () => {
  beforeEach(() => {
    gatewayFetch.mockReset();
    getStudent.mockReset();
    getStudent.mockResolvedValue({ id: STUDENT, firstName: 'Asha', lastName: 'Rao' });
  });

  it('shows an error alert, not "None recorded", when the record read returns 500', async () => {
    respond({
      '/health/records/': { ok: false, status: 500, data: null },
      '/health/vaccinations/': { ok: true, status: 200, data: { data: [] } },
    });
    await renderPage();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/unable to load health record/i);
    expect(screen.queryByText(/none recorded/i)).toBeNull();
    expect(screen.queryByText('Reported allergies on file.')).toBeNull();
  });

  it('shows an error alert when the record read is denied (403)', async () => {
    respond({ '/health/records/': { ok: false, status: 403, data: null } });
    await renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent(/refused access/i);
    expect(screen.queryByText(/none recorded/i)).toBeNull();
  });

  it('shows the explicit no-record state on 404', async () => {
    respond({
      '/health/records/': { ok: false, status: 404, data: null },
      '/health/vaccinations/': { ok: true, status: 200, data: { data: [] } },
    });
    await renderPage();
    expect(screen.getByTestId('health-no-record')).toHaveTextContent(/no health record on file/i);
    expect(screen.queryByText('Reported allergies on file.')).toBeNull();
  });

  it('flags a failed vaccinations read instead of an empty list', async () => {
    respond({
      '/health/records/': {
        ok: true,
        status: 200,
        data: {
          id: 'r1',
          studentId: STUDENT,
          studentName: 'Asha Rao',
          allergies: ['Peanut'],
          chronicConditions: ['Asthma'],
          lastUpdated: '2025-01-01',
        },
      },
      '/health/vaccinations/': { ok: false, status: 503, data: null },
    });
    await renderPage();
    expect(screen.getByText('Peanut')).toBeInTheDocument();
    expect(screen.getByTestId('health-vaccinations-error')).toHaveAttribute('role', 'alert');
  });
});
