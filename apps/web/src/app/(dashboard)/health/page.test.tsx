/**
 * /health overview links (UATENV-D26): the tenant-wide registers (vaccinations,
 * incidents) are linked only for the roles the health service serves them to.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HealthRecordsPage from './page';
import { requireSession } from '@/lib/auth/server';

const gatewayFetch = vi.fn();
vi.mock('@/lib/api/gateway', () => ({
  gatewayFetch: (...args: unknown[]) => gatewayFetch(...args),
  GatewayError: class GatewayError extends Error {},
}));
vi.mock('@/lib/auth/server', () => ({ requireSession: vi.fn() }));
vi.mock('@/lib/api/students', () => ({
  listStudents: vi.fn(async () => ({ data: [], meta: { totalItems: 0, totalPages: 1 } })),
  getStudent: vi.fn(async () => null),
}));
vi.mock('@/lib/api/staff', () => ({ listStaff: vi.fn(), getStaff: vi.fn() }));
vi.mock('@/lib/api/institutions', () => ({ listInstitutions: vi.fn(async () => []) }));
vi.mock('next-intl/server', async () => {
  const en = (await import('@/messages/en.json')).default as unknown as Record<
    string,
    Record<string, string>
  >;
  return {
    getTranslations: vi.fn(async (ns: string) => (key: string) => en[ns]?.[key] ?? key),
  };
});

function signIn(roleName: string) {
  vi.mocked(requireSession).mockResolvedValue({
    user: { sub: 'u-1', roles: [{ roleId: roleName, roleName }] },
  } as never);
}

beforeEach(() => {
  gatewayFetch.mockReset();
  gatewayFetch.mockResolvedValue({ ok: true, status: 200, data: { data: [] } });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('/health overview register links (UATENV-D26)', () => {
  it.each(['nurse', 'school_nurse', 'health_officer', 'counsellor'])(
    'hides Vaccinations and Incidents from a school-bound %s',
    async (roleName) => {
      signIn(roleName);
      render(await HealthRecordsPage());
      expect(screen.getByRole('link', { name: 'Allergies' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Vaccinations' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Incidents' })).toBeNull();
    },
  );

  it.each(['health_admin', 'SYSTEM_ADMIN'])('links both registers for %s', async (roleName) => {
    signIn(roleName);
    render(await HealthRecordsPage());
    expect(screen.getByRole('link', { name: 'Vaccinations' })).toHaveAttribute(
      'href',
      '/health/vaccinations',
    );
    expect(screen.getByRole('link', { name: 'Incidents' })).toHaveAttribute(
      'href',
      '/health/incidents',
    );
  });
});
