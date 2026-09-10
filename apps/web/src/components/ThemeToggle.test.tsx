/**
 * @vitest-environment jsdom
 *
 * ThemeToggle tests — Task 47.4 / Requirement 36 AC 1, 37.3
 *
 * Covers:
 *   • Click cycle: light → dark → system → light
 *   • Icon shown reflects the current selected mode (Sun/Moon/Monitor)
 *   • aria-label is sourced from `t('theme.toggle')` in the active locale
 *   • The control passes the 48 × 48 px touch-target rule (Req 37.3)
 *   • The pure `nextMode()` helper exposes the rotation contract
 *
 * The test mounts the toggle inside the real `<ThemeProvider>` so we
 * exercise the same `useTheme()` contract the production header does.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';

import { ThemeProvider, useTheme } from '@/providers/ThemeProvider';
import { ThemeToggle, THEME_CYCLE, nextMode } from './ThemeToggle';

// ─── matchMedia helper ───────────────────────────────────────────────────────

function installMatchMedia(initial = false): void {
  const mql = {
    matches: initial,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => true,
  };
  vi.spyOn(window, 'matchMedia').mockImplementation(() => mql as unknown as MediaQueryList);
}

// ─── i18n harness ────────────────────────────────────────────────────────────

const enMessages = {
  theme: { toggle: 'Toggle theme' },
};

const arMessages = {
  theme: { toggle: 'تبديل السمة' },
};

interface HarnessProps {
  locale?: 'en' | 'ar';
  /** Forces the provider into a known starting mode for the test. */
  initialMode?: 'light' | 'dark' | 'system';
  children?: React.ReactNode;
}

/**
 * Test harness that mounts `<ThemeProvider>` and a real
 * `<NextIntlClientProvider>` so `useTranslations('theme')` resolves the
 * same way it does in production. The optional `initialMode` flips the
 * provider into a known starting state via a small bootstrapper child.
 */
function Harness({ locale = 'en', initialMode, children }: HarnessProps) {
  const messages = locale === 'ar' ? arMessages : enMessages;
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ThemeProvider>
        {initialMode ? <ModeBootstrapper mode={initialMode} /> : null}
        {children}
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}

function ModeBootstrapper({ mode }: { mode: 'light' | 'dark' | 'system' }) {
  const { setMode } = useTheme();
  const initialized = React.useRef(false);
  // Run exactly once on mount so user-triggered clicks during the test
  // are not overwritten by the bootstrapper on subsequent renders.
  React.useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setMode(mode);
  }, [mode, setMode]);
  return null;
}

// ─── Test setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme');
  installMatchMedia(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── nextMode() pure helper ──────────────────────────────────────────────────

describe('nextMode() — cycle contract', () => {
  it('exposes the canonical Light → Dark → System rotation', () => {
    expect(THEME_CYCLE).toEqual(['light', 'dark', 'system']);
  });

  it('cycles light → dark → system → light', () => {
    expect(nextMode('light')).toBe('dark');
    expect(nextMode('dark')).toBe('system');
    expect(nextMode('system')).toBe('light');
  });

  it('treats an unexpected value as light and advances safely', () => {
    expect(nextMode('not-a-mode' as unknown as 'light')).toBe('dark');
  });
});

// ─── Render contract ─────────────────────────────────────────────────────────

describe('<ThemeToggle> — render contract', () => {
  it('renders an accessible button with the localized aria-label (en)', () => {
    render(
      <Harness initialMode="light">
        <ThemeToggle />
      </Harness>,
    );
    const button = screen.getByRole('button', { name: 'Toggle theme' });
    expect(button).toBeDefined();
    expect(button.getAttribute('data-mode')).toBe('light');
  });

  it('uses the Arabic translation when the locale is `ar` (RTL pilot)', () => {
    render(
      <Harness locale="ar" initialMode="light">
        <ThemeToggle />
      </Harness>,
    );
    const button = screen.getByRole('button', { name: 'تبديل السمة' });
    expect(button).toBeDefined();
  });

  it('shows the Sun icon when mode === "light"', () => {
    render(
      <Harness initialMode="light">
        <ThemeToggle />
      </Harness>,
    );
    const button = screen.getByRole('button', { name: 'Toggle theme' });
    // lucide-react renders an <svg> with a `lucide-sun` class on the icon.
    const icon = button.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute('class') || '').toMatch(/lucide-sun/i);
  });

  it('shows the Moon icon when mode === "dark"', () => {
    render(
      <Harness initialMode="dark">
        <ThemeToggle />
      </Harness>,
    );
    const button = screen.getByRole('button', { name: 'Toggle theme' });
    const icon = button.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute('class') || '').toMatch(/lucide-moon/i);
  });

  it('shows the Monitor icon when mode === "system"', () => {
    render(
      <Harness initialMode="system">
        <ThemeToggle />
      </Harness>,
    );
    const button = screen.getByRole('button', { name: 'Toggle theme' });
    const icon = button.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute('class') || '').toMatch(/lucide-monitor/i);
  });

  it('reserves a 48 × 48 px touch target (Requirement 37 AC 3)', () => {
    render(
      <Harness initialMode="light">
        <ThemeToggle />
      </Harness>,
    );
    const button = screen.getByRole('button', { name: 'Toggle theme' });
    const className = button.getAttribute('class') || '';
    expect(className).toMatch(/min-h-\[48px\]/);
    expect(className).toMatch(/min-w-\[48px\]/);
  });
});

// ─── Click cycle ─────────────────────────────────────────────────────────────

describe('<ThemeToggle> — click cycle (Requirement 36 AC 1)', () => {
  it('cycles light → dark → system → light on successive clicks', () => {
    render(
      <Harness initialMode="light">
        <ThemeToggle />
      </Harness>,
    );
    const button = screen.getByTestId('theme-toggle');

    // Starting from light.
    expect(button.getAttribute('data-mode')).toBe('light');

    act(() => {
      fireEvent.click(button);
    });
    expect(button.getAttribute('data-mode')).toBe('dark');

    act(() => {
      fireEvent.click(button);
    });
    expect(button.getAttribute('data-mode')).toBe('system');

    act(() => {
      fireEvent.click(button);
    });
    expect(button.getAttribute('data-mode')).toBe('light');
  });

  it('updates the rendered icon to track the current mode', () => {
    render(
      <Harness initialMode="light">
        <ThemeToggle />
      </Harness>,
    );
    const button = screen.getByTestId('theme-toggle');

    expect(button.querySelector('svg')!.getAttribute('class') || '').toMatch(/lucide-sun/i);

    act(() => {
      fireEvent.click(button);
    });
    expect(button.querySelector('svg')!.getAttribute('class') || '').toMatch(/lucide-moon/i);

    act(() => {
      fireEvent.click(button);
    });
    expect(button.querySelector('svg')!.getAttribute('class') || '').toMatch(/lucide-monitor/i);

    act(() => {
      fireEvent.click(button);
    });
    expect(button.querySelector('svg')!.getAttribute('class') || '').toMatch(/lucide-sun/i);
  });
});
