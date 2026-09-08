/**
 * @vitest-environment jsdom
 *
 * <MFAVerify> tests — Task 49.5 / Requirements 4.11, 37.3.
 *
 * Covers:
 *   • The 6-input control auto-advances on character entry, auto-retreats
 *     on Backspace when the current input is empty, and supports
 *     ArrowLeft/ArrowRight navigation.
 *   • Pasting a full 6-digit code distributes one digit per box and
 *     auto-submits via `verifyMfa()`.
 *   • Each input is labelled `Digit {n} of 6` (the per-cell aria-label
 *     contract from design.md §D).
 *   • The assembled code is submitted to `POST /api/auth/mfa/verify` via
 *     the `verifyMfa()` helper, the user is hard-navigated to `returnTo`
 *     on success, and an error message is surfaced on failure.
 *   • The token-missing branch routes the user back to /auth/signin
 *     without making a network call.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { LanguageProvider } from '@/providers/LanguageProvider';
import { BrandConfigProvider, type Brand } from '@/providers/BrandConfigProvider';
import enMessages from '@/messages/en.json';

import MFAVerify from './MFAVerify';

// ─── jsdom shims ────────────────────────────────────────────────────────────

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof globalThis.ResizeObserver;
}

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/session')>('@/lib/auth/session');
  return {
    ...actual,
    verifyMfa: vi.fn(),
  };
});

import { verifyMfa } from '@/lib/auth/session';
const mockVerifyMfa = vi.mocked(verifyMfa);

// ─── Fixtures ───────────────────────────────────────────────────────────────

const messages = enMessages as unknown as Record<string, Record<string, string>>;

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

function renderMFAVerify({
  initialEntry = '/auth/mfa-verify?token=mfa-challenge-abc',
}: {
  initialEntry?: string;
} = {}) {
  return render(
    <BrandConfigProvider initialBrand={SAMPLE_BRAND}>
      <LanguageProvider defaultLocale="en" messagesByLocale={{ en: messages }}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/auth/mfa-verify" element={<MFAVerify />} />
            <Route path="/auth/signin" element={<div data-testid="signin-page">signin</div>} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </BrandConfigProvider>,
  );
}

function getCells(): HTMLInputElement[] {
  return Array.from(
    { length: 6 },
    (_, i) => screen.getByTestId(`mfa-code-input-cell-${i}`) as HTMLInputElement,
  );
}

// ─── Setup ──────────────────────────────────────────────────────────────────

const originalLocation = window.location;

beforeEach(() => {
  mockVerifyMfa.mockReset();

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

describe('<MFAVerify> — 6-input layout & a11y', () => {
  it('renders six 48 px boxes labelled "Digit {n} of 6"', () => {
    renderMFAVerify();
    const cells = getCells();
    expect(cells).toHaveLength(6);
    cells.forEach((cell, i) => {
      expect(cell.getAttribute('aria-label')).toBe(`Digit ${i + 1} of 6`);
      expect(cell.className).toContain('h-12');
      expect(cell.className).toContain('w-12');
      expect(cell.getAttribute('inputMode')).toBe('numeric');
      expect(cell.getAttribute('autoComplete')).toBe('one-time-code');
    });
  });

  it('auto-advances focus on character entry', () => {
    renderMFAVerify();
    const cells = getCells();
    // The widget auto-focuses the first cell on mount.
    expect(document.activeElement).toBe(cells[0]);

    fireEvent.change(cells[0]!, { target: { value: '1' } });
    expect(document.activeElement).toBe(cells[1]);
    fireEvent.change(cells[1]!, { target: { value: '2' } });
    expect(document.activeElement).toBe(cells[2]);
  });

  it('auto-retreats on Backspace when the current input is empty', () => {
    renderMFAVerify();
    const cells = getCells();
    fireEvent.change(cells[0]!, { target: { value: '1' } });
    fireEvent.change(cells[1]!, { target: { value: '2' } });
    // Cursor sits in cell 2 which is empty — Backspace should retreat.
    fireEvent.keyDown(cells[2]!, { key: 'Backspace' });
    expect(document.activeElement).toBe(cells[1]);
    expect(cells[1]!.value).toBe('');
  });

  it('navigates with ArrowLeft and ArrowRight', () => {
    renderMFAVerify();
    const cells = getCells();
    act(() => cells[3]!.focus());

    fireEvent.keyDown(cells[3]!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(cells[2]);

    fireEvent.keyDown(cells[2]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cells[3]);
  });
});

describe('<MFAVerify> — paste handling', () => {
  it('distributes a pasted 6-digit code across all boxes and auto-submits', async () => {
    mockVerifyMfa.mockResolvedValueOnce({ success: true });
    renderMFAVerify();
    const cells = getCells();

    fireEvent.paste(cells[0]!, {
      clipboardData: { getData: () => '123456' },
    });

    expect(cells.map((c) => c.value).join('')).toBe('123456');

    await waitFor(() => {
      expect(mockVerifyMfa).toHaveBeenCalledWith('mfa-challenge-abc', '123456');
    });
  });

  it('strips non-digit characters from a pasted string', () => {
    // Even though the visible characters include separators, the
    // sanitized string is still 6 digits and would trigger
    // onComplete → verifyMfa. Mock it so the auto-submit resolves
    // cleanly during this assertion-focused test.
    mockVerifyMfa.mockResolvedValueOnce({ success: true });
    renderMFAVerify();
    fireEvent.paste(getCells()[0]!, {
      clipboardData: { getData: () => '12-34 56  ' },
    });
    expect(
      getCells()
        .map((c) => c.value)
        .join(''),
    ).toBe('123456');
  });
});

describe('<MFAVerify> — submission', () => {
  it('submits the assembled code to verifyMfa() and navigates to returnTo on success', async () => {
    mockVerifyMfa.mockResolvedValueOnce({ success: true });
    renderMFAVerify({
      initialEntry: '/auth/mfa-verify?token=mfa-challenge-abc&returnTo=%2Fapp%2Fstaff',
    });
    const cells = getCells();

    for (let i = 0; i < 6; i += 1) {
      fireEvent.change(cells[i]!, { target: { value: String(i + 1) } });
    }

    await waitFor(() => {
      expect(mockVerifyMfa).toHaveBeenCalledWith('mfa-challenge-abc', '123456');
    });

    await waitFor(() => {
      expect(window.location.href).toBe('/app/staff');
    });
  });

  it('falls back to /app/dashboard when returnTo is absent', async () => {
    mockVerifyMfa.mockResolvedValueOnce({ success: true });
    renderMFAVerify();
    const cells = getCells();
    for (let i = 0; i < 6; i += 1) {
      fireEvent.change(cells[i]!, { target: { value: String(i + 1) } });
    }
    await waitFor(() => {
      expect(window.location.href).toBe('/app/dashboard');
    });
  });

  it('surfaces the auth-service error message on failure and clears the inputs', async () => {
    mockVerifyMfa.mockResolvedValueOnce({
      success: false,
      message: 'That code is invalid or expired.',
    });
    renderMFAVerify();
    const cells = getCells();
    for (let i = 0; i < 6; i += 1) {
      fireEvent.change(cells[i]!, { target: { value: String(i + 1) } });
    }

    await waitFor(() => {
      expect(screen.getByTestId('mfa-verify-error').textContent).toContain(
        'That code is invalid or expired.',
      );
    });

    // Inputs are wiped so the user can retry without manually deleting
    // each digit.
    const refreshed = getCells();
    expect(refreshed.map((c) => c.value).join('')).toBe('');

    // No hard navigation should have happened.
    expect(window.location.href).toBe('');
  });

  it('keeps the manual submit disabled until 6 digits are entered', async () => {
    mockVerifyMfa.mockResolvedValueOnce({ success: true });
    renderMFAVerify();
    const button = screen.getByTestId('mfa-verify-submit') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    const cells = getCells();
    for (let i = 0; i < 5; i += 1) {
      fireEvent.change(cells[i]!, { target: { value: String(i + 1) } });
    }
    expect(button.disabled).toBe(true);

    fireEvent.change(cells[5]!, { target: { value: '6' } });
    // The 6th keystroke triggers auto-submit, so the button briefly
    // toggles to "Verifying" before the redirect resolves.
    await waitFor(() => {
      expect(mockVerifyMfa).toHaveBeenCalledTimes(1);
    });
  });
});

describe('<MFAVerify> — token-missing branch', () => {
  it('surfaces a token-missing alert and skips verifyMfa() when token is absent', () => {
    renderMFAVerify({ initialEntry: '/auth/mfa-verify' });
    expect(screen.getByTestId('mfa-verify-token-missing')).toBeTruthy();
    expect(mockVerifyMfa).not.toHaveBeenCalled();
    // The OTP boxes are not rendered in this branch.
    expect(screen.queryByTestId('mfa-code-input')).toBeNull();
  });
});

describe('<MFAVerify> — branding', () => {
  it('binds document.title to the active brand name via <DocumentTitle>', async () => {
    renderMFAVerify();
    await waitFor(() => {
      expect(document.title).toBe(`${messages.auth!.twoFactorAuthentication} | EduZo`);
    });
  });
});
