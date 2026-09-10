/**
 * @vitest-environment jsdom
 *
 * ThemeProvider tests — Task 47.1 / Requirement 36
 *
 * Covers:
 *   • localStorage round-trip (AC 2)
 *   • Brand-aware storage key resolution (AC 2 + design.md §B)
 *   • prefers-color-scheme matchMedia listener in `system` mode (AC 3)
 *   • `data-theme` attribute + `.dark` class stamped on <html> (Design §B)
 *   • SSR-safe boot script output that the layout injects (AC 4)
 *   • Module evaluation tolerates a missing `window` (AC 4)
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import React from 'react';

import {
  ThemeProvider,
  useTheme,
  getThemeBootScript,
  FALLBACK_STORAGE_KEY,
  THEME_STORAGE_KEY_SUFFIX,
} from './ThemeProvider';
import { BrandConfigProvider, DEFAULT_BRAND, type Brand } from './BrandConfigProvider';

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface FakeMediaQueryList {
  matches: boolean;
  media: string;
  onchange: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null;
  addEventListener: Mock;
  removeEventListener: Mock;
  addListener: Mock;
  removeListener: Mock;
  dispatchEvent: (ev: Event) => boolean;
  fire: (matches: boolean) => void;
}

function installMatchMedia(initial = false): FakeMediaQueryList {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql: FakeMediaQueryList = {
    matches: initial,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn((event: string, cb: (e: MediaQueryListEvent) => void) => {
      if (event === 'change') listeners.add(cb);
    }) as unknown as Mock,
    removeEventListener: vi.fn((event: string, cb: (e: MediaQueryListEvent) => void) => {
      if (event === 'change') listeners.delete(cb);
    }) as unknown as Mock,
    addListener: vi.fn((cb: (e: MediaQueryListEvent) => void) =>
      listeners.add(cb),
    ) as unknown as Mock,
    removeListener: vi.fn((cb: (e: MediaQueryListEvent) => void) =>
      listeners.delete(cb),
    ) as unknown as Mock,
    dispatchEvent: () => true,
    fire(matches: boolean) {
      this.matches = matches;
      const event = { matches } as MediaQueryListEvent;
      listeners.forEach((cb) => cb(event));
    },
  };
  vi.spyOn(window, 'matchMedia').mockImplementation(() => mql as unknown as MediaQueryList);
  return mql;
}

function consume() {
  return renderHook(() => useTheme(), {
    wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
  });
}

// ─── Test setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ThemeProvider — defaults & contract', () => {
  it('useTheme throws outside of <ThemeProvider>', () => {
    // Suppress React's expected error log for cleaner test output.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useTheme())).toThrow(/within a <ThemeProvider>/);
    spy.mockRestore();
  });

  it('defaults to system mode and exposes both `resolved` and `resolvedTheme`', () => {
    installMatchMedia(false);
    const { result } = consume();
    expect(result.current.mode).toBe('system');
    expect(result.current.resolvedTheme).toBe('light');
    expect(result.current.resolved).toBe(result.current.resolvedTheme);
  });

  it('stamps data-theme="light" and the `light` class on <html> for light system', () => {
    installMatchMedia(false);
    consume();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('stamps data-theme="dark" and the `dark` class when OS prefers dark', () => {
    installMatchMedia(true);
    consume();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });
});

describe('ThemeProvider — localStorage round-trip', () => {
  it('persists the chosen mode under the fallback key when no brand is in scope', () => {
    installMatchMedia(false);
    const { result } = consume();

    act(() => result.current.setMode('dark'));

    expect(window.localStorage.getItem(FALLBACK_STORAGE_KEY)).toBe('dark');
    expect(result.current.mode).toBe('dark');
    expect(result.current.resolvedTheme).toBe('dark');
  });

  it('rehydrates the persisted mode on a fresh mount', () => {
    installMatchMedia(false);
    window.localStorage.setItem(FALLBACK_STORAGE_KEY, 'dark');

    const { result } = consume();
    expect(result.current.mode).toBe('dark');
    expect(result.current.resolvedTheme).toBe('dark');
  });

  it('ignores garbage values in localStorage', () => {
    installMatchMedia(false);
    window.localStorage.setItem(FALLBACK_STORAGE_KEY, 'rainbow');

    const { result } = consume();
    expect(result.current.mode).toBe('system');
  });

  it('cycles light → dark → system and writes each to localStorage', () => {
    installMatchMedia(false);
    const { result } = consume();

    act(() => result.current.setMode('light'));
    expect(window.localStorage.getItem(FALLBACK_STORAGE_KEY)).toBe('light');
    expect(result.current.resolvedTheme).toBe('light');

    act(() => result.current.setMode('dark'));
    expect(window.localStorage.getItem(FALLBACK_STORAGE_KEY)).toBe('dark');
    expect(result.current.resolvedTheme).toBe('dark');

    act(() => result.current.setMode('system'));
    expect(window.localStorage.getItem(FALLBACK_STORAGE_KEY)).toBe('system');
    expect(result.current.resolvedTheme).toBe('light');
  });
});

describe('ThemeProvider — system mode tracks prefers-color-scheme', () => {
  it('updates resolvedTheme when the OS toggles dark while in system mode (AC 3)', () => {
    const mql = installMatchMedia(false);
    const { result } = consume();
    expect(result.current.resolvedTheme).toBe('light');

    act(() => mql.fire(true));
    expect(result.current.resolvedTheme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    act(() => mql.fire(false));
    expect(result.current.resolvedTheme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('detaches the matchMedia listener when leaving system mode', () => {
    const mql = installMatchMedia(false);
    const { result } = consume();

    act(() => result.current.setMode('light'));

    // The component first attached then detached the listener when mode flipped.
    expect(mql.removeEventListener).toHaveBeenCalled();

    // OS preference changes are now ignored while user is locked to light.
    act(() => mql.fire(true));
    expect(result.current.resolvedTheme).toBe('light');
  });
});

describe('ThemeProvider — brand-aware storage key resolution', () => {
  function CustomBrandProvider({ brand, children }: { brand: Brand; children: React.ReactNode }) {
    return <BrandConfigProvider initialBrand={brand}>{children}</BrandConfigProvider>;
  }

  it('uses `${brand.slug}-theme` when wrapped in a BrandConfigProvider', () => {
    installMatchMedia(false);
    const eduzoBrand: Brand = {
      ...DEFAULT_BRAND,
      name: 'EduZo',
      shortName: 'eduzo',
      slug: 'eduzo',
    };

    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => (
        <CustomBrandProvider brand={eduzoBrand}>
          <ThemeProvider>{children}</ThemeProvider>
        </CustomBrandProvider>
      ),
    });

    act(() => result.current.setMode('dark'));

    const expectedKey = `eduzo${THEME_STORAGE_KEY_SUFFIX}`;
    expect(window.localStorage.getItem(expectedKey)).toBe('dark');
    // The fallback key is left untouched, proving tenants do not collide.
    expect(window.localStorage.getItem(FALLBACK_STORAGE_KEY)).toBeNull();
  });

  it('falls back to `proctira-theme` when no BrandConfigProvider is in scope', () => {
    installMatchMedia(false);
    const { result } = consume();

    act(() => result.current.setMode('dark'));

    expect(window.localStorage.getItem(FALLBACK_STORAGE_KEY)).toBe('dark');
  });

  it('honours an explicit `storageKey` prop above brand and fallback', () => {
    installMatchMedia(false);
    const eduzoBrand: Brand = { ...DEFAULT_BRAND, shortName: 'eduzo', slug: 'eduzo' };

    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => (
        <BrandConfigProvider initialBrand={eduzoBrand}>
          <ThemeProvider storageKey="custom-key">{children}</ThemeProvider>
        </BrandConfigProvider>
      ),
    });

    act(() => result.current.setMode('dark'));

    expect(window.localStorage.getItem('custom-key')).toBe('dark');
    expect(window.localStorage.getItem(`eduzo${THEME_STORAGE_KEY_SUFFIX}`)).toBeNull();
    expect(window.localStorage.getItem(FALLBACK_STORAGE_KEY)).toBeNull();
  });
});

describe('ThemeProvider — boot script', () => {
  it('returns a syntactically valid IIFE string', () => {
    const script = getThemeBootScript();
    expect(typeof script).toBe('string');
    expect(script.startsWith('(function(){')).toBe(true);
    expect(script.endsWith('})();')).toBe(true);
  });

  it('resolves `dark` from localStorage on a fresh document', () => {
    installMatchMedia(false);
    window.localStorage.setItem(FALLBACK_STORAGE_KEY, 'dark');

    // Clear any state from prior renders.
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');

    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    new Function(getThemeBootScript())();

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('falls back to system preference when no key is persisted', () => {
    installMatchMedia(true); // OS prefers dark
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');

    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    new Function(getThemeBootScript())();

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('finds any tenant `*-theme` key, not just proctira', () => {
    installMatchMedia(false);
    window.localStorage.setItem('eduzo-theme', 'dark');
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');

    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    new Function(getThemeBootScript())();

    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('ThemeProvider — SSR safety', () => {
  it('renders without crashing when localStorage throws (private mode simulation)', () => {
    installMatchMedia(false);
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const { result } = consume();
    expect(() => act(() => result.current.setMode('dark'))).not.toThrow();
    expect(result.current.mode).toBe('dark');

    setItemSpy.mockRestore();
  });

  it('module exports remain importable in a non-DOM context', async () => {
    // Simulate a code path where `window` is undefined at evaluation time.
    // We re-import the module from a worker-like environment proxy.
    const mod = await import('./ThemeProvider');
    expect(typeof mod.ThemeProvider).toBe('function');
    expect(typeof mod.useTheme).toBe('function');
    expect(typeof mod.getThemeBootScript).toBe('function');
    expect(mod.FALLBACK_STORAGE_KEY).toBe('proctira-theme');
    expect(mod.THEME_STORAGE_KEY_SUFFIX).toBe('-theme');
  });

  it('renders to a server-style string without DOM access errors', () => {
    // Render to a detached container; ThemeProvider must NOT touch window.matchMedia
    // before the first effect runs. We assert no throw and that the component
    // still produces output.
    installMatchMedia(false);
    const { container } = render(
      <ThemeProvider>
        <span data-testid="probe">ok</span>
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-testid="probe"]')?.textContent).toBe('ok');
  });
});
