/**
 * @vitest-environment jsdom
 *
 * <SignIn> tests — Task 49.1 / Requirements 4.1, 4.16, 31.5, 43.5.
 *
 * Covers:
 *   • client-side validation: empty / malformed email and missing password
 *     surface inline errors and skip the API call
 *   • happy-path submit: posts to `/api/auth/login` and navigates to the
 *     `returnTo` destination via `window.location`
 *   • MFA branch: when `requiresMfa` is signalled by the auth contract,
 *     the user is routed to `/auth/mfa-verify?token=…&returnTo=…`
 *   • OAuth redirect: federated buttons (Google, Microsoft, Apple) point
 *     to `/api/auth/oauth/authorize?provider=…&returnTo=…`
 *   • brand binding: the document title pulls from `useBrand().name`
 *     (Requirement 43.5)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { LanguageProvider } from '@/providers/LanguageProvider';
import {
  BrandConfigProvider,
  type Brand,
} from '@/providers/BrandConfigProvider';
import enMessages from '@/messages/en.json';

import SignIn, { buildOAuthHref } from './SignIn';

// ─── jsdom shims ────────────────────────────────────────────────────────────

// Radix UI's Checkbox transitively pulls in `useSize`, which references
// `ResizeObserver`. jsdom doesn't ship one, so we stub a minimal class.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  // @ts-expect-error — assigning a stub onto the global is exactly what
  // we want for tests; jsdom doesn't provide one.
  globalThis.ResizeObserver = ResizeObserverStub;
}

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/session', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/auth/session')
  >('@/lib/auth/session');
  return {
    ...actual,
    signIn: vi.fn(),
  };
});

import { signIn } from '@/lib/auth/session';
const mockSignIn = vi.mocked(signIn);

// ─── Fixtures ───────────────────────────────────────────────────────────────

const messages = enMessages as unknown as Record<
  string,
  Record<string, string>
>;

const SAMPLE_BRAND: Brand = {
  name: 'EduZo',
  shortName: 'eduzo',
  slug: 'eduzo',
  logo: { url: 'https://example.test/eduzo.svg', alt: 'EduZo' },
  favicon: 'https://example.test/eduzo.ico',
  primary_color: 'hsl(222, 47%, 25%)',
  accent_color: 'hsl(190, 90%, 45%)',
  login_background: 'linear-gradient(180deg, #001 0%, #003 100%)',
  document_title_template: '{page} | {brand}',
};

function renderSignIn({
  initialEntry = '/auth/signin',
  brand = SAMPLE_BRAND,
}: {
  initialEntry?: string;
  brand?: Brand;
} = {}) {
  return render(
    <BrandConfigProvider initialBrand={brand}>
      <LanguageProvider
        defaultLocale="en"
        messagesByLocale={{ en: messages }}
      >
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/auth/signin" element={<SignIn />} />
            <Route
              path="/auth/mfa-verify"
              element={<div data-testid="mfa-page">MFA</div>}
            />
            <Route
              path="/auth/forgot-password"
              element={<div>forgot</div>}
            />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </BrandConfigProvider>,
  );
}

function fillCredentials(email: string, password: string): void {
  const emailInput = screen.getByLabelText(messages.auth!.emailAddress!);
  const passwordInput = screen.getByLabelText(messages.auth!.password!);
  act(() => {
    fireEvent.change(emailInput, { target: { value: email } });
    fireEvent.change(passwordInput, { target: { value: password } });
  });
}

function clickSubmit(): void {
  const submit = screen.getByTestId('signin-submit');
  act(() => {
    fireEvent.click(submit);
  });
}

// ─── Setup ──────────────────────────────────────────────────────────────────

const originalLocation = window.location;

beforeEach(() => {
  mockSignIn.mockReset();

  // Replace window.location so we can observe `href = …` assignments
  // without forcing jsdom to actually navigate (which would tear down
  // the document mid-test).
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      href: '',
      origin: 'http://localhost',
      assign: vi.fn(),
      replace: vi.fn(),
    },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
  vi.clearAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('<SignIn> — buildOAuthHref helper', () => {
  it('builds an authorize URL with provider and returnTo', () => {
    expect(buildOAuthHref('google', '/app/dashboard')).toBe(
      '/api/auth/oauth/authorize?provider=google&returnTo=%2Fapp%2Fdashboard',
    );
  });

  it('omits returnTo when empty', () => {
    expect(buildOAuthHref('apple', '')).toBe(
      '/api/auth/oauth/authorize?provider=apple',
    );
  });
});

describe('<SignIn> — form validation', () => {
  it('rejects an empty email and skips the API call', async () => {
    renderSignIn();
    clickSubmit();

    await waitFor(() => {
      expect(screen.getByTestId('signin-email-error').textContent).toBe(
        messages.auth!.emailRequired,
      );
    });
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('rejects a malformed email and skips the API call', async () => {
    renderSignIn();
    fillCredentials('not-an-email', 'hunter2');
    clickSubmit();

    await waitFor(() => {
      expect(screen.getByTestId('signin-email-error').textContent).toBe(
        messages.auth!.emailInvalid,
      );
    });
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('rejects an empty password and skips the API call', async () => {
    renderSignIn();
    fillCredentials('user@example.org', '');
    clickSubmit();

    await waitFor(() => {
      expect(screen.getByTestId('signin-password-error').textContent).toBe(
        messages.auth!.passwordRequired,
      );
    });
    expect(mockSignIn).not.toHaveBeenCalled();
  });
});

describe('<SignIn> — happy path submit', () => {
  it('calls signIn() with the entered credentials and navigates to returnTo', async () => {
    mockSignIn.mockResolvedValueOnce({ success: true });

    renderSignIn({ initialEntry: '/auth/signin?returnTo=%2Fapp%2Fstudents' });
    fillCredentials('admin@school.edu', 'CorrectHorse9');
    clickSubmit();

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith(
        'admin@school.edu',
        'CorrectHorse9',
      );
    });

    await waitFor(() => {
      expect(window.location.href).toBe('/app/students');
    });
  });

  it('falls back to /app/dashboard when returnTo is absent', async () => {
    mockSignIn.mockResolvedValueOnce({ success: true });

    renderSignIn();
    fillCredentials('admin@school.edu', 'CorrectHorse9');
    clickSubmit();

    await waitFor(() => {
      expect(window.location.href).toBe('/app/dashboard');
    });
  });

  it('surfaces the auth-service error message on failure', async () => {
    mockSignIn.mockResolvedValueOnce({
      success: false,
      message: 'Account is temporarily locked.',
    });

    renderSignIn();
    fillCredentials('admin@school.edu', 'CorrectHorse9');
    clickSubmit();

    await waitFor(() => {
      expect(screen.getByTestId('signin-form-error').textContent).toContain(
        'Account is temporarily locked.',
      );
    });
    // A failed login must not leak through to a redirect.
    expect(window.location.href).toBe('');
  });
});

describe('<SignIn> — MFA branch', () => {
  it('routes to /auth/mfa-verify with token and returnTo when MFA is required', async () => {
    mockSignIn.mockResolvedValueOnce({
      success: true,
      requiresMfa: true,
      mfaToken: 'mfa-challenge-abc',
    });

    renderSignIn({
      initialEntry: '/auth/signin?returnTo=%2Fapp%2Fstaff',
    });
    fillCredentials('admin@school.edu', 'CorrectHorse9');
    clickSubmit();

    await waitFor(() => {
      expect(screen.getByTestId('mfa-page')).toBeTruthy();
    });
    // The router should have moved past the SignIn screen — no hard
    // navigation happened.
    expect(window.location.href).toBe('');
  });
});

describe('<SignIn> — federated provider buttons', () => {
  it('renders Google, Microsoft, and Apple buttons that link to the authorize endpoint', () => {
    renderSignIn({ initialEntry: '/auth/signin?returnTo=%2Fapp%2Fdashboard' });

    const google = screen.getByTestId('signin-oauth-google') as HTMLAnchorElement;
    const microsoft = screen.getByTestId(
      'signin-oauth-microsoft',
    ) as HTMLAnchorElement;
    const apple = screen.getByTestId('signin-oauth-apple') as HTMLAnchorElement;

    // jsdom resolves anchor.href to an absolute URL; we only need the
    // path + query to verify the contract.
    const path = (a: HTMLAnchorElement) => a.getAttribute('href');
    expect(path(google)).toBe(
      '/api/auth/oauth/authorize?provider=google&returnTo=%2Fapp%2Fdashboard',
    );
    expect(path(microsoft)).toBe(
      '/api/auth/oauth/authorize?provider=microsoft&returnTo=%2Fapp%2Fdashboard',
    );
    expect(path(apple)).toBe(
      '/api/auth/oauth/authorize?provider=apple&returnTo=%2Fapp%2Fdashboard',
    );
  });

  it('does not invoke signIn() when an OAuth button is clicked', () => {
    renderSignIn();
    const apple = screen.getByTestId('signin-oauth-apple');
    act(() => {
      fireEvent.click(apple);
    });
    expect(mockSignIn).not.toHaveBeenCalled();
  });
});

describe('<SignIn> — brand binding', () => {
  it('binds document.title to the active brand name via <DocumentTitle>', async () => {
    renderSignIn({ brand: SAMPLE_BRAND });
    await waitFor(() => {
      expect(document.title).toBe(`${messages.auth!.signIn} | EduZo`);
    });
  });

  it('substitutes the brand name into the welcome subtitle', () => {
    renderSignIn({ brand: SAMPLE_BRAND });
    expect(
      screen.getByText('Sign in to EduZo to continue.'),
    ).toBeTruthy();
  });
});

describe('<SignIn> — query-string flags', () => {
  it('renders the session-expired alert when ?expired=true is set', () => {
    renderSignIn({ initialEntry: '/auth/signin?expired=true' });
    expect(screen.getByTestId('signin-session-expired')).toBeTruthy();
  });

  it('renders the OAuth-failed alert when ?error=… is set', () => {
    renderSignIn({ initialEntry: '/auth/signin?error=oauth_failed' });
    expect(screen.getByTestId('signin-oauth-error')).toBeTruthy();
  });
});
