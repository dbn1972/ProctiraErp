/**
 * @vitest-environment jsdom
 *
 * LanguageSelector tests — Task 48.3 / Requirement 18 AC 7
 *
 * Covers:
 *   • Renders an accessible trigger with `aria-label="Select language"`
 *     and the canonical 48 × 48 px touch-target chrome.
 *   • Lists every Indian_Language_Set locale by its native name
 *     (English, हिन्दी, தமிழ், తెలుగు, मराठी, বাংলা, ગુજરાતી, ಕನ್ನಡ)
 *     plus the RTL pilot (`ar` → العربية).
 *   • Marks the active locale with `aria-checked="true"` and a Check icon.
 *   • Calls `setLocale` with the chosen code on click.
 *   • Stamps the right `lang` attribute on each option so screen readers
 *     and the browser shape glyphs in the correct script.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';

import {
  LanguageSelector,
  LANGUAGE_SELECTOR_LOCALES,
  LOCALE_NATIVE_NAMES,
} from './LanguageSelector';
import { LanguageProvider, type TranslationMap } from '@/providers/LanguageProvider';

// Stub dynamic imports the provider triggers when ensureCatalog runs.
vi.mock('@/messages/en.json', () => ({
  default: { common: { save: 'Save' } } as TranslationMap,
}));
vi.mock('@/messages/hi.json', () => ({
  default: { common: { save: 'सहेजें' } } as TranslationMap,
}));
vi.mock('@/messages/ar.json', () => ({
  default: { common: { save: 'حفظ' } } as TranslationMap,
}));

// ─── Harness ─────────────────────────────────────────────────────────────────

interface HarnessProps {
  initialLocale?: string;
  children?: React.ReactNode;
}

function Harness({ initialLocale = 'en', children }: HarnessProps) {
  return (
    <LanguageProvider
      initialLocale={initialLocale}
      messagesByLocale={{
        en: { common: { save: 'Save' } } as TranslationMap,
      }}
    >
      {children}
    </LanguageProvider>
  );
}

/**
 * Opens the dropdown menu by pressing Space on the trigger. Radix
 * DropdownMenu's trigger handles `Space`, `Enter`, and `ArrowDown` as
 * keyboard openers, which routes through the same state machine as a
 * pointer click but works reliably in jsdom (which doesn't emit the
 * synthetic pointer-capture chain Radix listens for on real devices).
 */
function openMenu() {
  const trigger = screen.getByRole('button', { name: 'Select language' });
  act(() => {
    trigger.focus();
    fireEvent.keyDown(trigger, { key: ' ', code: 'Space' });
    fireEvent.keyUp(trigger, { key: ' ', code: 'Space' });
  });
  return trigger;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('lang');
  document.documentElement.removeAttribute('dir');
  // Radix DropdownMenu uses ResizeObserver and pointer-capture APIs that
  // jsdom does not implement. Stub them so the menu mounts without
  // crashing during the tests.
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  // hasPointerCapture / setPointerCapture / releasePointerCapture are
  // referenced by Radix internals when delegating focus.
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
  Element.prototype.setPointerCapture = Element.prototype.setPointerCapture ?? (() => {});
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('LANGUAGE_SELECTOR_LOCALES — table contract', () => {
  it('lists the Indian_Language_Set in canonical order plus the RTL pilot', () => {
    expect(LANGUAGE_SELECTOR_LOCALES).toEqual([
      'en',
      'hi',
      'ta',
      'te',
      'mr',
      'bn',
      'gu',
      'kn',
      'ar',
    ]);
  });

  it('exposes a native-name label for every locale in the dropdown', () => {
    for (const code of LANGUAGE_SELECTOR_LOCALES) {
      expect(LOCALE_NATIVE_NAMES[code]).toBeTruthy();
    }
  });

  it('uses the canonical native names mandated by Requirement 18 AC 7', () => {
    expect(LOCALE_NATIVE_NAMES.en).toBe('English');
    expect(LOCALE_NATIVE_NAMES.hi).toBe('हिन्दी');
    expect(LOCALE_NATIVE_NAMES.ta).toBe('தமிழ்');
    expect(LOCALE_NATIVE_NAMES.te).toBe('తెలుగు');
    expect(LOCALE_NATIVE_NAMES.mr).toBe('मराठी');
    expect(LOCALE_NATIVE_NAMES.bn).toBe('বাংলা');
    expect(LOCALE_NATIVE_NAMES.gu).toBe('ગુજરાતી');
    expect(LOCALE_NATIVE_NAMES.kn).toBe('ಕನ್ನಡ');
    expect(LOCALE_NATIVE_NAMES.ar).toBe('العربية');
  });
});

describe('<LanguageSelector> — render contract', () => {
  it('renders an accessible trigger with the spec-mandated aria-label', () => {
    render(
      <Harness>
        <LanguageSelector />
      </Harness>,
    );
    const trigger = screen.getByRole('button', { name: 'Select language' });
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute('data-current-locale')).toBe('en');
    // 48 × 48 px touch target (Requirement 37.3).
    expect(trigger.className).toMatch(/min-h-\[48px\]/);
    expect(trigger.className).toMatch(/min-w-\[48px\]/);
  });

  it('opens a dropdown listing every Indian_Language_Set locale by native name', () => {
    render(
      <Harness>
        <LanguageSelector />
      </Harness>,
    );
    openMenu();

    const menu = screen.getByRole('menu');
    expect(menu).toBeTruthy();

    // Verify all 8 Indian locales are present by native name.
    expect(within(menu).getByText('English')).toBeTruthy();
    expect(within(menu).getByText('हिन्दी')).toBeTruthy();
    expect(within(menu).getByText('தமிழ்')).toBeTruthy();
    expect(within(menu).getByText('తెలుగు')).toBeTruthy();
    expect(within(menu).getByText('मराठी')).toBeTruthy();
    expect(within(menu).getByText('বাংলা')).toBeTruthy();
    expect(within(menu).getByText('ગુજરાતી')).toBeTruthy();
    expect(within(menu).getByText('ಕನ್ನಡ')).toBeTruthy();
    // RTL pilot.
    expect(within(menu).getByText('العربية')).toBeTruthy();
  });

  it('marks the active locale with aria-checked="true"', () => {
    render(
      <Harness initialLocale="hi">
        <LanguageSelector />
      </Harness>,
    );
    openMenu();

    const items = screen.getAllByRole('menuitemradio');
    const active = items.find((el) => el.getAttribute('data-active') === 'true');
    expect(active).toBeTruthy();
    expect(active?.getAttribute('aria-checked')).toBe('true');
    expect(active?.getAttribute('data-locale')).toBe('hi');
    expect(active?.textContent).toContain('हिन्दी');
  });

  it('stamps the correct `lang` attribute on every option for script shaping', () => {
    render(
      <Harness>
        <LanguageSelector />
      </Harness>,
    );
    openMenu();

    const items = screen.getAllByRole('menuitemradio');
    for (const item of items) {
      const code = item.getAttribute('data-locale');
      expect(code).toBeTruthy();
      expect(item.getAttribute('lang')).toBe(code);
    }
  });
});

describe('<LanguageSelector> — selection (Requirement 18 AC 7)', () => {
  it('switches the active locale when an option is clicked', () => {
    render(
      <Harness initialLocale="en">
        <LanguageSelector />
      </Harness>,
    );

    // Initially English.
    expect(
      screen.getByRole('button', { name: 'Select language' }).getAttribute('data-current-locale'),
    ).toBe('en');

    openMenu();
    const hindiItem = screen
      .getAllByRole('menuitemradio')
      .find((el) => el.getAttribute('data-locale') === 'hi');
    expect(hindiItem).toBeTruthy();

    act(() => {
      // Radix DropdownMenuItem fires its `onSelect` callback on pointer-up
      // after a pointer-down (the Radix `<DismissableLayer>` click path).
      // jsdom does not synthesize the pointer chain from a `click`, so we
      // dispatch the events the menu actually listens for.
      fireEvent.pointerDown(hindiItem!, { button: 0 });
      fireEvent.pointerUp(hindiItem!, { button: 0 });
      fireEvent.click(hindiItem!);
    });

    // After selection, the trigger reflects the new locale. We re-query
    // the DOM because Radix re-renders the trigger element when the menu
    // closes (the `data-state` attribute flips closed → open → closed).
    expect(
      screen.getByRole('button', { name: 'Select language' }).getAttribute('data-current-locale'),
    ).toBe('hi');
  });

  it('updates document.documentElement.dir when switching to the RTL pilot (ar)', () => {
    render(
      <Harness initialLocale="en">
        <LanguageSelector />
      </Harness>,
    );

    // LanguageProvider stamps lang/dir on mount.
    expect(document.documentElement.dir).toBe('ltr');

    openMenu();
    const arabicItem = screen
      .getAllByRole('menuitemradio')
      .find((el) => el.getAttribute('data-locale') === 'ar');
    expect(arabicItem).toBeTruthy();

    act(() => {
      fireEvent.pointerDown(arabicItem!, { button: 0 });
      fireEvent.pointerUp(arabicItem!, { button: 0 });
      fireEvent.click(arabicItem!);
    });

    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('persists the chosen locale to localStorage (Requirement 18 AC 8)', () => {
    render(
      <Harness>
        <LanguageSelector />
      </Harness>,
    );

    openMenu();
    const tamilItem = screen
      .getAllByRole('menuitemradio')
      .find((el) => el.getAttribute('data-locale') === 'ta');
    expect(tamilItem).toBeTruthy();

    act(() => {
      fireEvent.pointerDown(tamilItem!, { button: 0 });
      fireEvent.pointerUp(tamilItem!, { button: 0 });
      fireEvent.click(tamilItem!);
    });

    // The provider chooses a brand-aware key. With no <BrandConfigProvider>
    // mounted in this harness, it falls back to `proctira-language`.
    expect(window.localStorage.getItem('proctira-language')).toBe('ta');
  });
});
