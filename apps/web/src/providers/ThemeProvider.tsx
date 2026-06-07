"use client";

/**
 * ThemeProvider — Theme mode context (Design Section B, Requirement 36)
 *
 * Owns the Theme_Mode state (`light`, `dark`, `system`):
 *
 *   1. **Initialization is SSR-safe.** Every `window` and `localStorage`
 *      access is guarded; the resolved theme falls back to `light` until
 *      the client environment is ready, matching the inline boot script in
 *      `app/layout.tsx` so there is no flash of wrong theme on hydrate
 *      (Requirement 36 AC 4).
 *
 *   2. **Persistence.** `setMode` writes to
 *      `localStorage[${brand.shortName}-theme]`. The brand short name is
 *      read from `useBrand()` when wrapped in a `<BrandConfigProvider>`;
 *      otherwise the storage key falls back to `proctira-theme` so a
 *      single browser can host multiple tenants without collision
 *      (Requirement 36 AC 2).
 *
 *   3. **System tracking.** While `mode === 'system'` the provider
 *      subscribes to `window.matchMedia('(prefers-color-scheme: dark)')`
 *      and re-resolves on every change event. The listener is detached
 *      whenever `mode` becomes `'light'` or `'dark'` (Requirement 36 AC 3).
 *
 *   4. **Class & attribute toggling.** The provider stamps both
 *      `data-theme="light|dark"` on `<html>` and toggles the `.dark`
 *      class so Tailwind's `dark:` variant and the `.dark { ... }` CSS
 *      token block both activate (Design Section B, Table C).
 *
 * The `useTheme()` hook returns `{ mode, resolvedTheme, setMode }` per the
 * task contract, plus `resolved` as a stable alias of `resolvedTheme` to
 * preserve the design.md type signature.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useBrand } from './BrandConfigProvider';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeContextValue {
  /** The mode the user picked. */
  mode: ThemeMode;
  /** Canonical resolved theme name per task contract. */
  resolvedTheme: ResolvedTheme;
  /** Alias of {@link resolvedTheme}; keeps the design.md signature stable. */
  resolved: ResolvedTheme;
  /** Set the theme mode and persist it. */
  setMode: (mode: ThemeMode) => void;
}

export interface ThemeProviderProps {
  children: React.ReactNode;
  /** Defaults to 'system' (Requirement 36 AC 4). */
  defaultMode?: ThemeMode;
  /**
   * Storage key override. When omitted the provider derives the key from
   * `${brand.shortName}-theme`, falling back to `proctira-theme` if no
   * `<BrandConfigProvider>` is in scope.
   */
  storageKey?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Storage-key suffix; the prefix is the brand shortName/slug. */
export const THEME_STORAGE_KEY_SUFFIX = '-theme';

/** Used at boot before `useBrand()` is reachable (Task 47.1). */
export const FALLBACK_STORAGE_KEY = `proctira${THEME_STORAGE_KEY_SUFFIX}`;

/**
 * Tiny script string injected by `app/layout.tsx` so the document is
 * stamped with the right `data-theme` and `dark` class on the FIRST paint,
 * before React hydrates. Exported for layout.tsx and tests.
 *
 * @param fallbackKey storage key to consult when the brand-scoped key is
 * missing; almost always `'proctira-theme'`.
 */
export function getThemeBootScript(fallbackKey: string = FALLBACK_STORAGE_KEY): string {
  // Single-line so it can be inlined inside a <Script strategy="beforeInteractive">.
  // The script reads any `*-theme` key it can find (most-recent brand) so
  // re-hydration after a brand switch still picks up the user's prior choice.
  return `(function(){try{var keys=Object.keys(localStorage);var mode=null;for(var i=0;i<keys.length;i++){if(keys[i].slice(-${THEME_STORAGE_KEY_SUFFIX.length})==='${THEME_STORAGE_KEY_SUFFIX}'){var v=localStorage.getItem(keys[i]);if(v==='light'||v==='dark'||v==='system'){mode=v;break;}}}if(!mode){var fb=localStorage.getItem('${fallbackKey}');if(fb==='light'||fb==='dark'||fb==='system')mode=fb;}if(!mode)mode='system';var resolved=mode;if(mode==='system'){resolved=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}var root=document.documentElement;root.dataset.theme=resolved;if(resolved==='dark'){root.classList.add('dark');root.classList.remove('light');}else{root.classList.add('light');root.classList.remove('dark');}}catch(e){document.documentElement.dataset.theme='light';}})();`;
}

// ─── SSR-safe helpers ────────────────────────────────────────────────────────

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function getSystemTheme(): ResolvedTheme {
  if (!isBrowser() || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

function getPersistedMode(storageKey: string): ThemeMode | null {
  if (!isBrowser()) return null;
  try {
    const stored = window.localStorage.getItem(storageKey);
    return isThemeMode(stored) ? stored : null;
  } catch {
    return null;
  }
}

function persistMode(storageKey: string, mode: ThemeMode): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(storageKey, mode);
  } catch {
    /* localStorage may be unavailable (private mode, quota, etc.) */
  }
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') return getSystemTheme();
  return mode;
}

function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (!isBrowser()) return;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  // Maintain BOTH `.light` and `.dark` so legacy CSS in
  // packages/ui/styles/theme.css (`:root.light`, `:root.dark`) and
  // Tailwind v3's `darkMode: 'class'` strategy both activate.
  if (resolved === 'dark') {
    root.classList.add('dark');
    root.classList.remove('light');
  } else {
    root.classList.add('light');
    root.classList.remove('dark');
  }
}

/**
 * Resolve the storage key to use:
 *   1. Explicit `storageKey` prop wins.
 *   2. Otherwise `${brand.shortName ?? brand.slug}-theme` from
 *      `useBrand()` when available.
 *   3. Otherwise the `proctira-theme` fallback.
 *
 * Reading `useBrand()` is wrapped in a try/catch so the ThemeProvider can
 * be mounted standalone (e.g. in Storybook, in error boundaries, in tests).
 */
function useResolvedStorageKey(override?: string): string {
  // Try to consume the brand context. If no provider is in scope React
  // simply returns `undefined` from `useContext` — the provider's hook
  // throws in that case, so we trap it to keep ThemeProvider standalone-safe.
  let brandShortName: string | undefined;
  try {
    const { brand } = useBrand();
    // The `Brand` interface in BrandConfigProvider exposes `slug` today;
    // future tenants may add an explicit `shortName` field. Either works.
    brandShortName =
      (brand as { shortName?: string }).shortName ?? brand.slug ?? undefined;
  } catch {
    brandShortName = undefined;
  }

  return useMemo(() => {
    if (override) return override;
    if (brandShortName) return `${brandShortName}${THEME_STORAGE_KEY_SUFFIX}`;
    return FALLBACK_STORAGE_KEY;
  }, [override, brandShortName]);
}

// ─── Context ─────────────────────────────────────────────────────────────────

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// ─── Provider ────────────────────────────────────────────────────────────────

export function ThemeProvider({
  children,
  defaultMode = 'system',
  storageKey,
}: ThemeProviderProps) {
  const resolvedStorageKey = useResolvedStorageKey(storageKey);

  // SSR-safe initial state: read localStorage only on the client.
  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (!isBrowser()) return defaultMode;
    return getPersistedMode(resolvedStorageKey) ?? defaultMode;
  });

  // The resolved theme is `light` on the server (matches the inline boot
  // script's worst-case branch) and reconciles after hydration via the
  // first `useEffect` below.
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => {
    if (!isBrowser()) return 'light';
    return resolveTheme(mode);
  });

  // If the storage key changes (e.g. brand swap) re-read persisted value.
  const lastKeyRef = useRef(resolvedStorageKey);
  useEffect(() => {
    if (lastKeyRef.current === resolvedStorageKey) return;
    lastKeyRef.current = resolvedStorageKey;
    const persisted = getPersistedMode(resolvedStorageKey);
    if (persisted && persisted !== mode) {
      setModeState(persisted);
    }
  }, [resolvedStorageKey, mode]);

  const setMode = useCallback(
    (next: ThemeMode) => {
      if (!isThemeMode(next)) return;
      setModeState(next);
      persistMode(resolvedStorageKey, next);
      const nextResolved = resolveTheme(next);
      setResolvedTheme(nextResolved);
      applyResolvedTheme(nextResolved);
    },
    [resolvedStorageKey],
  );

  // Apply the resolved theme on mount and whenever it changes.
  useEffect(() => {
    if (!isBrowser()) return;
    const next = resolveTheme(mode);
    setResolvedTheme(next);
    applyResolvedTheme(next);
  }, [mode]);

  // Subscribe to `prefers-color-scheme` while in `system` mode (AC 3).
  useEffect(() => {
    if (!isBrowser()) return;
    if (mode !== 'system') return;
    if (typeof window.matchMedia !== 'function') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event: MediaQueryListEvent) => {
      const next: ResolvedTheme = event.matches ? 'dark' : 'light';
      setResolvedTheme(next);
      applyResolvedTheme(next);
    };

    // Older Safari exposes `addListener` instead of `addEventListener`.
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }
    const legacy = mediaQuery as unknown as {
      addListener: (cb: (e: MediaQueryListEvent) => void) => void;
      removeListener: (cb: (e: MediaQueryListEvent) => void) => void;
    };
    legacy.addListener(handler);
    return () => legacy.removeListener(handler);
  }, [mode]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolvedTheme,
      resolved: resolvedTheme,
      setMode,
    }),
    [mode, resolvedTheme, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Access the current theme mode and resolved theme.
 * Must be used within a `<ThemeProvider>`.
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a <ThemeProvider>');
  }
  return context;
}
