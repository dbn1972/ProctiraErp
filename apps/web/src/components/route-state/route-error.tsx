'use client';

/**
 * The panel every `error.tsx` in the app renders.
 *
 * ## V15-17 — localised, and why the fallbacks stay
 *
 * The title and body were English literals, so a school operating in Hindi or Tamil read
 * English failure copy on every route boundary. `useTranslations` works here because this is
 * a client component and `LanguageProvider` mounts `NextIntlClientProvider` above it.
 *
 * This is an **error boundary's** panel, so it is worth being explicit about what it may
 * depend on. `error.tsx` renders *inside* the root layout, which is where
 * `LanguageProvider` mounts `NextIntlClientProvider` — so the provider is always in scope
 * here. The case where it is not is a failure of the layout itself, and that is
 * `global-error.tsx`, which is deliberately dependency-free and does not use this panel.
 *
 * So the hook is called unconditionally, as the rules of hooks require. Only the *lookup* is
 * guarded, and only against a missing key: next-intl echoes the namespaced key when a
 * message is absent, and `routeState.renderErrorTitle` is not copy to show a user. An
 * earlier revision wrapped the hook itself in try/catch — eslint rejected it as a
 * conditional hook call, and it was right to: that guard was defending against a case that
 * cannot occur here.
 *
 * ## V15-18 — the error's own message is no longer shown
 *
 * It used to render `error.message` as the body. That string is whatever threw: a gateway
 * envelope, a driver message, a library assertion. It is the same disclosure the gateway's
 * 500 branch masks, and it is not actionable for the person reading it. The body is now
 * fixed copy, and `digest` — the identifier the server log carries for the same error — is
 * offered as a quotable reference instead.
 */

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@proctira/ui/components';

/** English fallbacks, used when the catalogue is unavailable. */
const FALLBACK = {
  title: 'Something went wrong',
  body: 'An unexpected error occurred while loading this page.',
  tryAgain: 'Try again',
  reference: 'Reference',
} as const;

export function RouteErrorPanel({
  error,
  reset,
  title,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  /** Segment-specific heading, e.g. "Dashboard error". Localised copy wins when absent. */
  title?: string;
}) {
  useEffect(() => {
    console.error('[route] error boundary:', error);
  }, [error]);

  const t = useSafeRouteStateTranslations();

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex flex-col items-center justify-center gap-4 py-16 text-center"
      data-testid="route-error-panel"
    >
      <h2 className="text-lg font-semibold text-foreground">
        {title ?? t('renderErrorTitle', FALLBACK.title)}
      </h2>
      <p className="max-w-md text-sm text-muted-foreground">
        {t('renderErrorBody', FALLBACK.body)}
      </p>
      <Button type="button" onClick={() => reset()} data-testid="route-error-reset">
        {t('tryAgain', FALLBACK.tryAgain)}
      </Button>
      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground/70" data-testid="route-error-digest">
          {t('reference', FALLBACK.reference)}: {error.digest}
        </p>
      ) : null}
    </div>
  );
}

/**
 * `useTranslations('routeState')` with a per-key English fallback.
 *
 * The hook is called unconditionally. Only the lookup is defended, because next-intl echoes
 * the namespaced key when a message is missing and `routeState.renderErrorTitle` is not copy
 * to put in front of a user — a locale catalogue that has drifted should degrade to English,
 * not to a key name, on the one screen a user reaches when something is already wrong.
 */
function useSafeRouteStateTranslations(): (key: string, fallback: string) => string {
  const translate = useTranslations('routeState');
  return (key, fallback) => {
    try {
      const value = translate(key);
      return value && !value.includes('routeState.') ? value : fallback;
    } catch {
      return fallback;
    }
  };
}
