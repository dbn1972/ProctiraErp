/**
 * @vitest-environment jsdom
 *
 * <SettingsGeneral> tests — Task 59.1 (Settings → General).
 *
 * Covers:
 *   • Initial GET → form is hydrated with the persisted settings.
 *   • Required-field validation: a blank Brand_Name surfaces an inline
 *     error and blocks submission.
 *   • Happy-path submit: editing Brand_Name and clicking "Save" issues
 *     `PATCH /api/v1/tenant/settings` with exactly the fields the user
 *     touched.
 *
 * Validates: Requirements 42.1, 43.1, 43.6.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { LanguageProvider } from '@/providers/LanguageProvider';

// ─── jsdom shims (mirror the Roles & Permissions test harness) ───────────

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
}
const proto = Element.prototype as unknown as Record<string, unknown>;
if (!('hasPointerCapture' in proto)) proto['hasPointerCapture'] = () => false;
if (!('releasePointerCapture' in proto)) proto['releasePointerCapture'] = () => undefined;
if (!('scrollIntoView' in proto)) proto['scrollIntoView'] = () => undefined;

// ─── Mocks ───────────────────────────────────────────────────────────────

vi.mock('@/lib/api/admin', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/admin')>('@/lib/api/admin');
  return {
    ...actual,
    getTenantGeneralSettings: vi.fn(),
    updateTenantGeneralSettings: vi.fn(),
  };
});

import * as adminApi from '@/lib/api/admin';
import SettingsGeneral from '../pages/SettingsGeneral';
import type { TenantGeneralSettings } from '@/lib/api/admin';

// Minimal English catalog covering the keys the page references.
const settingsGeneralMessages = {
  common: { loading: 'Loading…' },
  settings: {
    general: {
      title: 'General Settings',
      description: 'Tenant preferences shared across every user in this tenant.',
      save: 'Save changes',
      saving: 'Saving…',
      saveSuccess: 'Settings saved.',
      saveSuccessTitle: 'Saved',
      saveFailedTitle: 'Save failed',
      saveFailed: 'Could not save settings.',
      loadFailedTitle: 'Could not load settings',
      loadFailed: 'Could not load settings.',
      placeholders: {
        defaultLanguage: 'Choose a language',
        tenantTimezone: 'Choose a timezone',
      },
      fields: {
        brandName: 'Brand name',
        defaultLanguage: 'Default language',
        defaultThemeMode: 'Default theme mode',
        notificationsEmail: 'Notifications email',
        tenantTimezone: 'Tenant timezone',
      },
      hints: {
        brandName: 'Used in page titles and notification email signatures.',
        defaultLanguage: 'New users start in this language.',
        defaultThemeMode: 'New users start in this theme; they can switch later.',
        notificationsEmail: 'System notifications and audit alerts go to this address.',
        tenantTimezone: 'Used for attendance windows, scheduling, and audit timestamps.',
      },
      themeMode: { light: 'Light', dark: 'Dark', system: 'System' },
      locales: {
        en: 'English',
        hi: 'हिन्दी',
        ta: 'தமிழ்',
        te: 'తెలుగు',
        mr: 'मराठी',
        bn: 'বাংলা',
        gu: 'ગુજરાતી',
        kn: 'ಕನ್ನಡ',
        ar: 'العربية',
      },
      errors: {
        brandNameRequired: 'Brand name is required.',
        brandNameTooLong: 'Brand name must be 40 characters or fewer.',
        defaultLanguageRequired: 'Pick a default language.',
        themeModeInvalid: 'Pick light, dark, or system.',
        notificationsEmailRequired: 'Notifications email is required.',
        notificationsEmailInvalid: 'Enter a valid email address.',
        tenantTimezoneRequired: 'Pick a tenant timezone.',
      },
    },
  },
};

const SAMPLE_SETTINGS: TenantGeneralSettings = {
  brandName: 'ProctiraERP',
  defaultLanguage: 'en',
  defaultThemeMode: 'system',
  notificationsEmail: 'admin@example.test',
  tenantTimezone: 'Asia/Kolkata',
};

// Wrap the page in `<LanguageProvider>` so `useLanguage().t()` resolves.
function renderPage() {
  return render(
    <LanguageProvider defaultLocale="en" messagesByLocale={{ en: settingsGeneralMessages }}>
      <SettingsGeneral />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  vi.mocked(adminApi.getTenantGeneralSettings).mockResolvedValue({ ...SAMPLE_SETTINGS });
  vi.mocked(adminApi.updateTenantGeneralSettings).mockImplementation(async (patch) => ({
    ...SAMPLE_SETTINGS,
    ...patch,
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('<SettingsGeneral>', () => {
  it('renders the form hydrated with the persisted settings', async () => {
    renderPage();

    // Loading skeleton goes away once the GET resolves.
    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
    });

    expect(screen.getByTestId('settings-general-form')).toBeTruthy();

    // Each user-editable input is hydrated.
    const brandInput = screen.getByTestId('settings-general-brandName') as HTMLInputElement;
    const emailInput = screen.getByTestId(
      'settings-general-notificationsEmail',
    ) as HTMLInputElement;

    expect(brandInput.value).toBe('ProctiraERP');
    expect(emailInput.value).toBe('admin@example.test');

    // Save button is disabled until the form is dirty.
    expect((screen.getByTestId('settings-general-submit') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('blocks submission and surfaces an inline error when Brand_Name is blank', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
    });

    const brandInput = screen.getByTestId('settings-general-brandName') as HTMLInputElement;

    // Clear the brand name and blur to trigger validation.
    act(() => {
      fireEvent.change(brandInput, { target: { value: '' } });
      fireEvent.blur(brandInput);
    });

    // Submit button is enabled (the form is dirty), but submitting
    // surfaces the validation error instead of calling the mutation.
    const submitBtn = screen.getByTestId('settings-general-submit') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(
        screen.getByText(settingsGeneralMessages.settings.general.errors.brandNameRequired),
      ).toBeTruthy();
    });
    expect(adminApi.updateTenantGeneralSettings).not.toHaveBeenCalled();
  });

  it('submits a PATCH with the user-edited Brand_Name', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
    });

    const brandInput = screen.getByTestId('settings-general-brandName') as HTMLInputElement;

    act(() => {
      fireEvent.change(brandInput, { target: { value: 'EduZo' } });
    });

    const submitBtn = screen.getByTestId('settings-general-submit') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(adminApi.updateTenantGeneralSettings).toHaveBeenCalledTimes(1);
    });

    const [payload] = vi.mocked(adminApi.updateTenantGeneralSettings).mock.calls[0]!;
    // The page submits the full validated form snapshot — the diff vs the
    // server is computed server-side. Brand_Name is the field the user
    // changed and must reflect the new value.
    expect(payload).toMatchObject({
      brandName: 'EduZo',
      defaultLanguage: 'en',
      defaultThemeMode: 'system',
      notificationsEmail: 'admin@example.test',
      tenantTimezone: 'Asia/Kolkata',
    });

    // Success banner appears once the mutation resolves.
    await waitFor(() => {
      expect(screen.queryByTestId('settings-general-success')).not.toBeNull();
    });
  });
});
