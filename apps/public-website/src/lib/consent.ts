/**
 * Single source of truth for the visitor's cookie/analytics consent.
 *
 * Any future tracker MUST gate on `hasAnalyticsConsent()` / `useConsent()`
 * and load only when the stored choice is `analytics`. The choice is kept in
 * localStorage (not a cookie) and can be changed or withdrawn at any time via
 * the footer "Cookie settings" control, which dispatches OPEN_SETTINGS_EVENT.
 */
import { useEffect, useState } from 'react';

export const CONSENT_STORAGE_KEY = 'proctira-cookie-consent';
export const CONSENT_CHANGE_EVENT = 'proctira:consent-change';
export const OPEN_SETTINGS_EVENT = 'proctira:open-cookie-settings';

export type ConsentChoice = 'essential' | 'analytics';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function parseConsent(value: string | null | undefined): ConsentChoice | null {
  return value === 'essential' || value === 'analytics' ? value : null;
}

export function readConsent(storage: StorageLike | null = defaultStorage()): ConsentChoice | null {
  try {
    return parseConsent(storage?.getItem(CONSENT_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeConsent(
  choice: ConsentChoice,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(CONSENT_STORAGE_KEY, choice);
  } catch {
    // Storage blocked: the choice still applies for this page view.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ConsentChoice>(CONSENT_CHANGE_EVENT, { detail: choice }));
  }
}

/** True only when the visitor explicitly allowed analytics. Default: false. */
export function hasAnalyticsConsent(storage: StorageLike | null = defaultStorage()): boolean {
  return readConsent(storage) === 'analytics';
}

/** Ask the consent bar to reopen so the visitor can change or withdraw a choice. */
export function openCookieSettings(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT));
  }
}

/** React hook: current consent (undefined until hydrated, null if never chosen). */
export function useConsent(): ConsentChoice | null | undefined {
  const [choice, setChoice] = useState<ConsentChoice | null | undefined>(undefined);
  useEffect(() => {
    setChoice(readConsent());
    const onChange = (event: Event) => {
      setChoice(parseConsent((event as CustomEvent<string>).detail));
    };
    window.addEventListener(CONSENT_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, onChange);
  }, []);
  return choice;
}
