/**
 * @vitest-environment jsdom
 *
 * <SettingsBranding> tests — Task 59.2 (Settings → Branding).
 *
 * Covers the acceptance criteria for the page:
 *   • Renders the form hydrated from `GET /api/v1/tenant/branding`.
 *   • Updating a colour value updates the on-the-fly contrast read-out
 *     using the same WCAG math as the publish-time guard (Task 58.4).
 *   • The "Preview" toggle calls the cookie helper from Task 58.3.
 *   • The "Publish" action calls the publish API with the form values
 *     and surfaces a structured field error inline.
 *
 * Validates: Requirements 42.2, 42.3, 28.7, 28.8, 28.9, 28.10.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { LanguageProvider } from '@/providers/LanguageProvider';

// ─── jsdom shims (mirror the Settings → General test harness) ──────────────

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
if (!('releasePointerCapture' in proto))
  proto['releasePointerCapture'] = () => undefined;
if (!('scrollIntoView' in proto)) proto['scrollIntoView'] = () => undefined;

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('@/lib/branding/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/branding/api')>(
    '@/lib/branding/api',
  );
  return {
    ...actual,
    getBrandingState: vi.fn(),
    saveBrandingDraft: vi.fn(),
    publishBranding: vi.fn(),
    rollbackBranding: vi.fn(),
  };
});

import * as brandingApi from '@/lib/branding/api';
import SettingsBranding from '../pages/SettingsBranding';
import { AdminApiError } from '@/lib/branding/api';

// English catalogue covering the keys the page references. Mirrors the
// shape we ship in `apps/web/src/messages/en.json`.
const messages = {
  common: { loading: 'Loading…' },
  settings: {
    branding: {
      title: 'Branding',
      description: 'Customise the platform appearance for your tenant.',
      currentRevision: 'Current revision: {revision}',
      previewToggle: 'Preview draft branding',
      previewEnabled: 'Preview enabled.',
      previewDisabled: 'Preview disabled.',
      saveDraft: 'Save draft',
      publish: 'Publish',
      publishing: 'Publishing…',
      successTitle: 'Saved',
      errorTitle: 'Save failed',
      draftSaved: 'Draft saved.',
      draftSaveFailed: 'Could not save draft.',
      publishSuccess: 'Branding published.',
      publishFailed: 'Could not publish branding.',
      publishValidationFailed: 'Validation failed.',
      loadFailed: 'Could not load branding.',
      loadFailedTitle: 'Could not load branding',
      contrastLabel: 'Contrast {ratio}:1 (min {threshold}:1 vs white)',
      sections: {
        identity: 'Logo & identity',
        colors: 'Colour theme',
        loginBackground: 'Login background',
      },
      fields: {
        logo: 'Tenant logo',
        favicon: 'Favicon',
        primary: 'Primary colour',
        accent: 'Accent colour',
        loginBg: 'Login background',
      },
      hints: {
        logo: 'SVG or PNG, ≤ 200 × 60 px.',
        favicon: 'ICO or PNG, exactly 32 × 32 px.',
        primary: 'Used for buttons and links. Must score ≥ 4.5:1 against white.',
        accent: 'Used for highlights. Must score ≥ 3:1 against white.',
        loginBg: 'Image URL or CSS gradient.',
      },
      placeholders: {
        logo: 'https://cdn.example.com/logo.svg',
        logoUpload: 'Drop a logo here or click to browse.',
        favicon: 'https://cdn.example.com/favicon.ico',
        faviconUpload: 'Drop a favicon here or click to browse.',
        loginBg:
          'linear-gradient(135deg, hsl(222, 47%, 22%), hsl(222, 47%, 40%))',
      },
      preview: {
        label: 'Live preview',
        title: 'Live preview',
        signIn: 'Sign in',
        appLabel: 'ProctiraERP',
        hint: 'Preview updates in real time as you edit fields.',
      },
      errors: {
        logoRequired: 'Logo is required.',
        logoReadFailed: 'Could not read the selected logo file.',
        faviconRequired: 'Favicon is required.',
        faviconReadFailed: 'Could not read the selected favicon file.',
        primaryContrast:
          'Primary colour contrast must be at least 4.5:1 against white.',
        accentContrast:
          'Accent colour contrast must be at least 3:1 against white.',
        loginBgRequired: 'Login background is required.',
      },
    },
  },
};

const SAMPLE_STATE: brandingApi.TenantBrandingState = {
  draft: null,
  published: {
    revision: 3,
    publishedAt: '2025-01-01T00:00:00.000Z',
    publishedBy: '00000000-0000-4000-8000-000000000000',
    tokens: {
      '--tenant-logo': 'url("/logo.svg")',
      '--tenant-favicon': 'url("/favicon.ico")',
      '--tenant-primary': 'hsl(222, 47%, 31%)',
      '--tenant-accent': 'hsl(174, 62%, 40%)',
      '--tenant-login-bg':
        'linear-gradient(135deg, hsl(222, 47%, 22%), hsl(222, 47%, 40%))',
    },
  },
};

const previewMock = {
  isEnabled: vi.fn(() => false),
  enable: vi.fn(),
  disable: vi.fn(),
};

function renderPage() {
  return render(
    <LanguageProvider
      defaultLocale="en"
      messagesByLocale={{ en: messages }}
    >
      <SettingsBranding previewCookie={previewMock} />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  vi.mocked(brandingApi.getBrandingState).mockResolvedValue({
    draft: SAMPLE_STATE.draft,
    published: SAMPLE_STATE.published
      ? { ...SAMPLE_STATE.published, tokens: { ...SAMPLE_STATE.published.tokens } }
      : null,
  });
  vi.mocked(brandingApi.saveBrandingDraft).mockImplementation(
    async ({ tokens, savedBy }) => ({
      tokens,
      savedBy,
      savedAt: '2025-01-02T00:00:00.000Z',
    }),
  );
  vi.mocked(brandingApi.publishBranding).mockImplementation(
    async ({ tokens, publishedBy }) => ({
      tokens,
      revision: 4,
      publishedAt: '2025-01-02T00:00:00.000Z',
      publishedBy,
    }),
  );
  previewMock.isEnabled.mockReturnValue(false);
  previewMock.enable.mockReset();
  previewMock.disable.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('<SettingsBranding>', () => {
  it('renders the form hydrated with the published tokens', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
    });

    expect(screen.getByTestId('settings-branding-form')).toBeTruthy();

    const primary = screen.getByTestId(
      'settings-branding-primaryColor',
    ) as HTMLInputElement;
    expect(primary.value).toBe('hsl(222, 47%, 31%)');

    const accent = screen.getByTestId(
      'settings-branding-accentColor',
    ) as HTMLInputElement;
    expect(accent.value).toBe('hsl(174, 62%, 40%)');

    // Logo URL is unwrapped from the `url("...")` CSS form.
    const logo = screen.getByTestId(
      'settings-branding-logoUrl',
    ) as HTMLInputElement;
    expect(logo.value).toBe('/logo.svg');

    // Live preview pane mounted.
    expect(screen.getByTestId('settings-branding-preview')).toBeTruthy();
  });

  it('updates the contrast ratio read-out as the primary colour changes', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
    });

    const primary = screen.getByTestId(
      'settings-branding-primaryColor',
    ) as HTMLInputElement;
    const ratio = screen.getByTestId('settings-branding-primaryRatio');
    const initialRatio = ratio.textContent ?? '';

    // Switching to pure white should drop the ratio to ~1:1.
    act(() => {
      fireEvent.change(primary, { target: { value: '#ffffff' } });
    });

    await waitFor(() => {
      const next = ratio.textContent ?? '';
      expect(next).not.toBe(initialRatio);
      expect(next).toMatch(/1\.00/);
    });
  });

  it('flips the preview cookie when the toggle is clicked', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
    });

    const toggle = screen.getByTestId('settings-branding-preview-toggle');

    act(() => {
      fireEvent.click(toggle);
    });

    await waitFor(() => {
      expect(previewMock.enable).toHaveBeenCalledTimes(1);
    });
  });

  it('publishes the form values through the publish API', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
    });

    // Make a small dirty edit so the preview updates and we can confirm
    // the published payload reflects it.
    const accent = screen.getByTestId(
      'settings-branding-accentColor',
    ) as HTMLInputElement;
    act(() => {
      fireEvent.change(accent, { target: { value: 'hsl(174, 62%, 35%)' } });
    });

    const publish = screen.getByTestId(
      'settings-branding-publish',
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(publish);
    });

    await waitFor(() => {
      expect(brandingApi.publishBranding).toHaveBeenCalledTimes(1);
    });

    const [payload] = vi.mocked(brandingApi.publishBranding).mock.calls[0]!;
    expect(payload.publishedBy).toBe('00000000-0000-4000-8000-000000000000');
    expect(payload.tokens).toMatchObject({
      '--tenant-logo': 'url("/logo.svg")',
      '--tenant-favicon': 'url("/favicon.ico")',
      '--tenant-primary': 'hsl(222, 47%, 31%)',
      '--tenant-accent': 'hsl(174, 62%, 35%)',
      '--tenant-login-bg':
        'linear-gradient(135deg, hsl(222, 47%, 22%), hsl(222, 47%, 40%))',
    });

    await waitFor(() => {
      expect(screen.queryByTestId('settings-branding-success')).not.toBeNull();
    });
  });

  it('surfaces a structured publish-time error next to the failing field', async () => {
    vi.mocked(brandingApi.publishBranding).mockRejectedValueOnce(
      new AdminApiError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: {
          errors: [
            {
              field: 'tokens.--tenant-primary',
              rule: 'contrast',
              message: 'Primary colour does not meet 4.5:1 against white.',
            },
          ],
        },
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
    });

    const publish = screen.getByTestId(
      'settings-branding-publish',
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(publish);
    });

    await waitFor(() => {
      expect(
        screen.getByText('Primary colour does not meet 4.5:1 against white.'),
      ).toBeTruthy();
    });
  });
});
