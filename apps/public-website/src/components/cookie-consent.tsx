'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'proctira-cookie-consent';

type ConsentChoice = 'essential' | 'analytics';

/**
 * Minimal consent bar. Essential is the default. Allow analytics only
 * stores the preference — this site does not load a tracker today.
 */
export function CookieConsent() {
  const [choice, setChoice] = useState<ConsentChoice | null | undefined>(undefined);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      setChoice(stored === 'essential' || stored === 'analytics' ? stored : null);
    } catch {
      setChoice(null);
    }
  }, []);

  function save(value: ConsentChoice) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Preference still applies for this view if storage is blocked.
    }
    setChoice(value);
  }

  if (choice === undefined || choice === 'essential' || choice === 'analytics') {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-labelledby="cookie-consent-title"
      aria-describedby="cookie-consent-body"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card shadow-lg"
      data-testid="cookie-consent"
    >
      <div className="container flex flex-col gap-4 py-4 md:flex-row md:items-center md:justify-between">
        <div className="max-w-3xl">
          <p id="cookie-consent-title" className="font-semibold text-foreground">
            Cookies on this site
          </p>
          <p id="cookie-consent-body" className="mt-1 text-sm text-muted-foreground">
            Essential cookies keep the site working. We do not set an analytics cookie unless you
            allow it. Allowing analytics records that choice in this browser; no analytics cookie is
            loaded today.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-12"
            onClick={() => save('essential')}
          >
            Essential only
          </Button>
          <Button type="button" className="min-h-12" onClick={() => save('analytics')}>
            Allow analytics
          </Button>
        </div>
      </div>
    </div>
  );
}
