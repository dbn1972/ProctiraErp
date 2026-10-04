'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  OPEN_SETTINGS_EVENT,
  openCookieSettings,
  readConsent,
  writeConsent,
  type ConsentChoice,
} from '@/lib/consent';

/**
 * Non-modal consent bar (role="region", not a dialog: it does not trap focus
 * or block the page). Essential is the default. "Allow analytics" only stores
 * the preference — this site does not load a tracker today; any future tracker
 * must gate on `useConsent()` / `hasAnalyticsConsent()` from `@/lib/consent`.
 *
 * The footer "Cookie settings" control reopens the bar so a choice can be
 * changed or withdrawn; focus moves to the bar and returns on save.
 */
export function CookieConsent() {
  const [choice, setChoice] = useState<ConsentChoice | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const regionRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const reopenedRef = useRef(false);

  useEffect(() => {
    const stored = readConsent();
    setChoice(stored);
    setOpen(stored === null);
    const onOpen = () => {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      reopenedRef.current = true;
      setChoice(readConsent());
      setOpen(true);
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (open && reopenedRef.current) {
      regionRef.current?.focus();
    }
  }, [open]);

  function save(value: ConsentChoice) {
    writeConsent(value);
    setChoice(value);
    setOpen(false);
    if (reopenedRef.current) {
      reopenedRef.current = false;
      returnFocusRef.current?.focus();
    }
  }

  if (choice === undefined || !open) {
    return null;
  }
  return (
    <div
      ref={regionRef}
      role="region"
      aria-labelledby="cookie-consent-title"
      aria-describedby="cookie-consent-body"
      tabIndex={-1}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="cookie-consent"
      data-current-choice={choice ?? 'none'}
    >
      <div className="container flex flex-col gap-4 py-4 md:flex-row md:items-center md:justify-between">
        <div className="max-w-3xl">
          <h2 id="cookie-consent-title" className="font-semibold text-foreground">
            Cookie settings
          </h2>
          <p id="cookie-consent-body" className="mt-1 text-sm text-muted-foreground">
            Essential cookies keep the site working. We do not set an analytics cookie unless you
            allow it. Allowing analytics records that choice in this browser; no analytics cookie is
            loaded today. You can change or withdraw this choice at any time from Cookie settings in
            the footer.
            {choice ? (
              <>
                {' '}
                Current choice:{' '}
                <strong>{choice === 'analytics' ? 'analytics allowed' : 'essential only'}</strong>.
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-12"
            aria-pressed={choice === 'essential'}
            onClick={() => save('essential')}
          >
            Essential only
          </Button>
          <Button
            type="button"
            className="min-h-12"
            aria-pressed={choice === 'analytics'}
            onClick={() => save('analytics')}
          >
            Allow analytics
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Footer control that reopens the consent bar to change or withdraw a choice. */
export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      data-testid="cookie-settings"
      onClick={openCookieSettings}
    >
      Cookie settings
    </button>
  );
}
