/**
 * apps/web/src/lib/sw/register.ts — Service-worker registration bootstrap
 * (Task 60.5, Requirements 38.1, 38.4, 38.5, 38.8, Design §I)
 * =====================================================================
 *
 * Single source of truth for *when* the Frontend_Shell registers
 * `/sw.js`. The thin React shim `<ServiceWorkerRegister>` delegates
 * here so the gating logic is decoupled from React, easy to unit
 * test, and reusable from a SPA bootstrap (e.g. a future Vite
 * `apps/web/src/main.tsx` shell — Design §I calls this out as the
 * canonical entry point) without dragging the React tree along.
 *
 * Registration is gated on three conditions, ALL of which must hold:
 *
 *   1. **Browser environment.** `typeof window !== 'undefined'` — the
 *      function is a no-op on the Next.js server so it can be
 *      imported from any module without breaking SSR.
 *
 *   2. **Service worker support.** `'serviceWorker' in navigator` —
 *      older browsers, `file://` origins, and reduced-feature
 *      WebViews silently skip registration. Offline support is an
 *      enhancement, not a requirement, so a missing API is not an
 *      error.
 *
 *   3. **Production + secure context.** Service workers will not
 *      install on `http://` origins (except `localhost` for dev), so
 *      we additionally require `window.isSecureContext === true`.
 *      Combined with `process.env.NODE_ENV === 'production'` this
 *      guarantees we never register in `next dev` HMR sessions or
 *      Playwright/jsdom test runs, and never attempt registration
 *      against a non-HTTPS staging origin where it would fail loudly
 *      in DevTools.
 *
 * Failures are deliberately swallowed: `register()` rejection is
 * logged via `console.warn` and never thrown into the host. The page
 * continues to function as a regular SPA without offline cache.
 *
 * The helper returns a small `RegisterResult` discriminated union so
 * unit tests can assert which gate fired without scraping
 * `console.warn` output.
 */

/** Default location of the SW script on the public origin. */
export const DEFAULT_SW_SCRIPT_URL = '/sw.js';

/**
 * Outcome of `registerServiceWorker()`. The string tag identifies
 * exactly which gate fired so tests do not have to rely on side
 * effects (console output) to assert behaviour.
 */
export type RegisterResult =
  | { status: 'registered'; scriptUrl: string }
  | { status: 'skipped-non-browser' }
  | { status: 'skipped-non-production' }
  | { status: 'skipped-insecure-context' }
  | { status: 'skipped-unsupported' };

/**
 * Options accepted by `registerServiceWorker`. Each option exists for
 * a specific test seam; production callers should rely on the defaults.
 */
export interface RegisterServiceWorkerOptions {
  /** SW script URL. Defaults to `/sw.js`. */
  scriptUrl?: string;
  /**
   * Override the production gate. Defaults to
   * `process.env.NODE_ENV === 'production'`. Mostly useful for tests
   * that want to exercise the production path without setting
   * `NODE_ENV`, or for a self-hosted build that wants to enable the
   * SW in a non-`production` runtime.
   */
  isProduction?: boolean;
  /**
   * Override the secure-context gate. Defaults to reading
   * `window.isSecureContext`. Tests that want to drive the gate
   * without monkey-patching the global pass `false` here.
   */
  isSecureContext?: boolean;
  /**
   * Override the registration call. Defaults to
   * `navigator.serviceWorker.register`. Tests inject a stub here to
   * assert call arguments without polluting jsdom's `navigator`.
   */
  register?: (scriptUrl: string) => Promise<unknown>;
  /**
   * Optional logger sink. Defaults to `console.warn`. Tests can
   * silence output while still asserting the message via
   * `RegisterResult`.
   */
  onRegistrationError?: (err: unknown) => void;
}

/**
 * Register `/sw.js` if (and only if) all three gates are satisfied.
 * Returns synchronously with the gate result; the actual
 * `register()` promise is fired-and-forgotten so the caller (a
 * `useEffect`) does not have to `await` an enhancement.
 *
 * @returns A `RegisterResult` describing which branch executed.
 */
export function registerServiceWorker(
  options: RegisterServiceWorkerOptions = {},
): RegisterResult {
  // ─── Gate 1: browser environment ────────────────────────────────────────
  // Bail before touching `window` so the helper is safe to import from
  // server components / Node-only modules.
  if (typeof window === 'undefined') {
    return { status: 'skipped-non-browser' };
  }

  // ─── Gate 2: production-only ────────────────────────────────────────────
  // Service workers are intentionally disabled in development and test
  // builds so they cannot interfere with `next dev` HMR or leak between
  // Playwright/jsdom runs.
  const isProduction =
    options.isProduction ?? process.env.NODE_ENV === 'production';
  if (!isProduction) {
    return { status: 'skipped-non-production' };
  }

  // ─── Gate 3a: secure context ────────────────────────────────────────────
  // Browsers refuse to install a SW on plain `http://` (except on
  // `localhost`). We require an explicit secure context to keep the
  // failure path quiet when an operator forgets the HTTPS terminator.
  const secure =
    options.isSecureContext ??
    (typeof window.isSecureContext === 'boolean' ? window.isSecureContext : false);
  if (!secure) {
    return { status: 'skipped-insecure-context' };
  }

  // ─── Gate 3b: API available ─────────────────────────────────────────────
  // If the caller injected a `register` override (test seam) we trust
  // them to have provided a working implementation and skip the
  // navigator probe — otherwise the gate would reject jsdom even when
  // the test has wired its own stub.
  const hasNativeServiceWorker = 'serviceWorker' in navigator;
  if (!options.register && !hasNativeServiceWorker) {
    return { status: 'skipped-unsupported' };
  }

  const scriptUrl = options.scriptUrl ?? DEFAULT_SW_SCRIPT_URL;

  // Bind the registration call. Tests can substitute their own; in
  // production we call through to `navigator.serviceWorker.register`.
  const register =
    options.register ??
    ((url: string): Promise<unknown> =>
      navigator.serviceWorker.register(url));

  // Fire-and-forget. `sw.js` itself manages skipWaiting + clients.claim,
  // so there is no follow-up state to surface here.
  const onError =
    options.onRegistrationError ??
    ((err: unknown): void => {
      // eslint-disable-next-line no-console
      console.warn('[sw] registration failed', err);
    });

  register(scriptUrl).catch(onError);

  return { status: 'registered', scriptUrl };
}

export default registerServiceWorker;
