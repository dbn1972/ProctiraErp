/**
 * @vitest-environment jsdom
 *
 * <ConnectivityIndicator> tests — Task 54.3 / Requirements 38.1, 38.2, 38.3.
 *
 * Verifies the three-state widget contract documented in
 * `ConnectivityIndicator.tsx` and Design §I:
 *
 *   1. Online state — green dot + localised "Online" label.
 *   2. Offline state — yellow dot + localised "Offline" label.
 *   3. Syncing state — animated dot + localised "Syncing" label.
 *
 * The state is mocked at the `useConnectivity()` boundary so each test
 * can drive a known status independently of the real provider's
 * heartbeat / browser-event plumbing (which is exercised by the
 * provider's own tests).
 *
 * The localisation contract is verified through a real
 * `<NextIntlClientProvider>` so the tests catch any missing key in
 * `apps/web/src/messages/{en,ar}.json` rather than passing against an
 * inline mock dictionary.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';

import enMessages from '@/messages/en.json';
import arMessages from '@/messages/ar.json';

// ─── Mock useConnectivity() so each test can drive a known state ─────────────

const mockUseConnectivity = vi.fn();

vi.mock('@/providers/ConnectivityProvider', () => ({
  useConnectivity: () => mockUseConnectivity(),
}));

import { ConnectivityIndicator } from './ConnectivityIndicator';
import type { ConnectivityStatus } from '@/providers/ConnectivityProvider';

// ─── Harness ─────────────────────────────────────────────────────────────────

interface HarnessProps {
  locale?: 'en' | 'ar';
  children: React.ReactNode;
}

function Harness({ locale = 'en', children }: HarnessProps) {
  const messages = locale === 'ar' ? arMessages : enMessages;
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

function setStatus(status: ConnectivityStatus) {
  mockUseConnectivity.mockReturnValue({
    status,
    isOnline: status === 'online' || status === 'syncing',
    isSyncing: status === 'syncing',
    checkConnectivity: vi.fn(),
    replaySyncQueue: vi.fn(),
  });
}

// ─── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  mockUseConnectivity.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── Online ──────────────────────────────────────────────────────────────────

describe('<ConnectivityIndicator> — online state (Req 38.1)', () => {
  it('renders the green dot and the localised "Online" label', () => {
    setStatus('online');
    render(
      <Harness>
        <ConnectivityIndicator />
      </Harness>,
    );

    const root = screen.getByTestId('connectivity-indicator');
    const dot = screen.getByTestId('connectivity-indicator-dot');
    const label = screen.getByTestId('connectivity-indicator-label');

    expect(root.getAttribute('data-status')).toBe('online');
    // Green from the Tailwind emerald palette.
    expect(dot.className).toContain('bg-emerald-500');
    // Pulse animation is reserved for the syncing state — not online.
    expect(dot.className).not.toContain('animate-pulse');
    expect(label.textContent).toBe('Online');
  });

  it('exposes role="status" with aria-live="polite" so screen readers announce updates', () => {
    setStatus('online');
    render(
      <Harness>
        <ConnectivityIndicator />
      </Harness>,
    );
    const root = screen.getByTestId('connectivity-indicator');
    expect(root.getAttribute('role')).toBe('status');
    expect(root.getAttribute('aria-live')).toBe('polite');
  });
});

// ─── Offline ─────────────────────────────────────────────────────────────────

describe('<ConnectivityIndicator> — offline state (Req 38.2)', () => {
  it('renders the yellow dot and the localised "Offline" label', () => {
    setStatus('offline');
    render(
      <Harness>
        <ConnectivityIndicator />
      </Harness>,
    );

    const root = screen.getByTestId('connectivity-indicator');
    const dot = screen.getByTestId('connectivity-indicator-dot');
    const label = screen.getByTestId('connectivity-indicator-label');

    expect(root.getAttribute('data-status')).toBe('offline');
    // Yellow per the task brief — Tailwind amber reads as a saturated yellow.
    expect(dot.className).toContain('bg-amber-500');
    expect(dot.className).not.toContain('animate-pulse');
    expect(label.textContent).toBe('Offline');
  });
});

// ─── Syncing ─────────────────────────────────────────────────────────────────

describe('<ConnectivityIndicator> — syncing state (Req 38.3)', () => {
  it('renders the animated dot and the localised "Syncing" label', () => {
    setStatus('syncing');
    render(
      <Harness>
        <ConnectivityIndicator />
      </Harness>,
    );

    const root = screen.getByTestId('connectivity-indicator');
    const dot = screen.getByTestId('connectivity-indicator-dot');
    const label = screen.getByTestId('connectivity-indicator-label');

    expect(root.getAttribute('data-status')).toBe('syncing');
    // Animated pulse signals replay-in-progress.
    expect(dot.className).toContain('animate-pulse');
    expect(label.textContent).toBe('Syncing');
  });
});

// ─── Dot sizing (≥ 12 px per the task brief) ─────────────────────────────────

describe('<ConnectivityIndicator> — dot meets the 12 px minimum diameter', () => {
  it('uses Tailwind `h-3 w-3` (= 12 px) so the dot is visible at a glance', () => {
    setStatus('online');
    render(
      <Harness>
        <ConnectivityIndicator />
      </Harness>,
    );
    const dot = screen.getByTestId('connectivity-indicator-dot');
    expect(dot.className).toContain('h-3');
    expect(dot.className).toContain('w-3');
    expect(dot.className).toContain('rounded-full');
  });
});

// ─── Localisation (Arabic) ───────────────────────────────────────────────────

describe('<ConnectivityIndicator> — localised labels resolve from next-intl', () => {
  it('translates the label into Arabic when the locale is "ar"', () => {
    setStatus('online');
    render(
      <Harness locale="ar">
        <ConnectivityIndicator />
      </Harness>,
    );
    const label = screen.getByTestId('connectivity-indicator-label');
    // Matches the value in ar.json → connectivity.online.
    expect(label.textContent).toBe('متصل');
  });

  it('translates the offline label into Arabic when the locale is "ar"', () => {
    setStatus('offline');
    render(
      <Harness locale="ar">
        <ConnectivityIndicator />
      </Harness>,
    );
    expect(screen.getByTestId('connectivity-indicator-label').textContent).toBe(
      'غير متصل',
    );
  });

  it('translates the syncing label into Arabic when the locale is "ar"', () => {
    setStatus('syncing');
    render(
      <Harness locale="ar">
        <ConnectivityIndicator />
      </Harness>,
    );
    expect(screen.getByTestId('connectivity-indicator-label').textContent).toBe(
      'جاري المزامنة',
    );
  });
});

// ─── Icon-only mode ──────────────────────────────────────────────────────────

describe('<ConnectivityIndicator> — iconOnly mode', () => {
  it('omits the visible label but keeps the localised text on aria-label', () => {
    setStatus('online');
    render(
      <Harness>
        <ConnectivityIndicator iconOnly />
      </Harness>,
    );
    expect(screen.queryByTestId('connectivity-indicator-label')).toBeNull();
    expect(screen.getByTestId('connectivity-indicator').getAttribute('aria-label')).toBe(
      'Online',
    );
    // The dot is still rendered so the indicator is visible at a glance.
    const dot = screen.getByTestId('connectivity-indicator-dot');
    expect(dot.className).toContain('h-3');
    expect(dot.className).toContain('w-3');
  });
});
