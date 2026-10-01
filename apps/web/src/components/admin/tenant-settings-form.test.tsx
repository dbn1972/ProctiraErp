import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const saveTenantSettings = vi.fn();
vi.mock('@/lib/api/admin.server', () => ({
  createTenantRole: vi.fn(),
  deleteTenantRole: vi.fn(),
  inviteTenantUser: vi.fn(),
  saveTenantSettings: (...args: unknown[]) => saveTenantSettings(...args),
  setTenantUserRoles: vi.fn(),
  setTenantUserStatus: vi.fn(),
  updateTenantRole: vi.fn(),
}));

import { SettingsField, TenantSettingsForm } from './admin-console-controls';
import { saveTenantSettingsAction } from '@/app/(dashboard)/admin/actions';
import { settingsIssuesToFieldErrors } from '@/lib/admin/settings-field-errors';
import type { TenantSettings } from '@/lib/api/admin.server';

const SETTINGS: TenantSettings = {
  tenantId: 't1',
  displayName: 'Demo School',
  defaultLocale: 'en',
  supportedLocales: ['en', 'hi'],
  timezone: 'Asia/Kolkata',
  academicYearStartMonth: 4,
  branding: { primaryColor: '#1d4ed8', accentColor: '#0ea5e9', logoUrl: null },
  contact: { email: null, phone: null },
  updatedAt: '2026-01-01T00:00:00Z',
  updatedBy: null,
};

describe('tenant settings nested validation errors (PRC-L066)', () => {
  it('maps nested issue paths to input ids', () => {
    expect(
      settingsIssuesToFieldErrors([
        { path: ['branding', 'primaryColor'], message: 'bad colour' },
        { path: ['contact', 'email'], message: 'bad email' },
        { path: ['supportedLocales', 1], message: 'bad locale' },
        { path: ['displayName'], message: 'required' },
      ]),
    ).toEqual({
      primaryColor: 'bad colour',
      contactEmail: 'bad email',
      supportedLocales: 'bad locale',
      displayName: 'required',
    });
  });

  it('shows an invalid primary colour error under the Primary colour input', async () => {
    // React 18 in vitest does not run `<form action={fn}>`, so drive the real server
    // action and feed its fieldErrors into the same SettingsField the form renders.
    const res = await saveTenantSettingsAction({
      ...SETTINGS,
      branding: { ...SETTINGS.branding, primaryColor: 'blue' },
    });
    expect(res.status).toBe('error');
    expect(res.fieldErrors).toEqual({ primaryColor: 'Use a hex colour like #1d4ed8' });
    expect(saveTenantSettings).not.toHaveBeenCalled();

    render(
      <SettingsField id="primaryColor" label="Primary colour" error={res.fieldErrors?.primaryColor}>
        <input id="primaryColor" name="primaryColor" defaultValue="blue" />
      </SettingsField>,
    );
    const input = screen.getByLabelText('Primary colour');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'primaryColor-error');
    expect(document.getElementById('primaryColor-error')).toHaveTextContent(
      'Use a hex colour like #1d4ed8',
    );
  });

  it('renders the form with hints linked to their inputs', () => {
    render(<TenantSettingsForm settings={SETTINGS} />);
    const tz = screen.getByLabelText('Timezone');
    expect(tz).not.toHaveAttribute('aria-invalid');
    expect(tz).toHaveAttribute('aria-describedby', 'timezone-hint');
  });
});
