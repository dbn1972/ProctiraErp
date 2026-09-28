/**
 * @vitest-environment jsdom
 *
 * PreviewStateSwitcher tests (Task 10.3, `principal-dashboard-parity`,
 * Requirements 6.1, 6.10).
 *
 * `PreviewStateSwitcher` is a `'use client'` component that calls
 * `useRouter()` (`next/navigation`) unconditionally at the top level, so
 * `next/navigation` must be mocked before import — this suite overrides the
 * shared `test-setup.ts` stub with a locally-scoped `refresh` mock (same
 * pattern as `CommandPalette.test.tsx`'s `mockPush`) so the SAME function
 * reference is called across every render, regardless of which render's
 * closure the click handler was captured from.
 *
 * `global.fetch` is mocked per-test via `vi.stubGlobal('fetch', ...)` (the
 * pattern used by `apps/web/src/lib/api/gateway.test.ts` and
 * `apps/web/src/middleware.test.ts`) since the component calls the global
 * `fetch` directly — it has no injectable fetcher prop like
 * `SchoolFinder.tsx` does.
 *
 * The mount-time "highlight the active state" behaviour
 * (`readActivePreviewStateFromBrowser()`) is exercised by seeding real
 * `document.cookie` values with `encodePreviewStateCookieValue()` rather
 * than mocking `@/lib/dashboard/previewStateCookie` — this is the module's
 * own real browser-reading code path, not a stand-in for it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: mockRefresh,
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

import { PreviewStateSwitcher } from './PreviewStateSwitcher';
import {
  PREVIEW_STATE_COOKIE_NAME,
  PREVIEW_STATES,
  encodePreviewStateCookieValue,
} from '@/lib/dashboard/previewStateCookie';
import { PREVIEW_STATE_LABELS } from '@/lib/dashboard/previewStateLabels';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fetchMock = vi.fn<[string, RequestInit?], Promise<Response>>();

/** A recent, well-within-the-30-minute-window timestamp for "active" cookies. */
function recentEpochSeconds(): number {
  return Math.floor(Date.now() / 1000) - 30;
}

function clearPreviewStateCookie(): void {
  document.cookie = `${PREVIEW_STATE_COOKIE_NAME}=; Path=/; Max-Age=0`;
}

/** Seeds `document.cookie` with a validly-encoded, unexpired preview state. */
function seedPreviewStateCookie(state: (typeof PREVIEW_STATES)[number]): void {
  document.cookie = `${PREVIEW_STATE_COOKIE_NAME}=${encodePreviewStateCookieValue(
    state,
    recentEpochSeconds(),
  )}; Path=/`;
}

function mockResponse(init: { ok: boolean; status: number; body?: unknown }): Response {
  return {
    ok: init.ok,
    status: init.status,
    json: async () => init.body ?? {},
  } as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  mockRefresh.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  clearPreviewStateCookie();
});

afterEach(() => {
  cleanup();
  clearPreviewStateCookie();
  vi.unstubAllGlobals();
});

// ─── Visibility gating (Req 6.1) ─────────────────────────────────────────────

describe('<PreviewStateSwitcher> — visibility gating (Req 6.1)', () => {
  it('renders nothing when canManagePreview is false', () => {
    const { container } = render(<PreviewStateSwitcher canManagePreview={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('does not render the root test id when canManagePreview is false', () => {
    render(<PreviewStateSwitcher canManagePreview={false} />);
    expect(screen.queryByTestId('preview-state-switcher')).toBeNull();
  });

  it('never calls fetch when canManagePreview is false, even with an active cookie present', () => {
    seedPreviewStateCookie('filled');
    render(<PreviewStateSwitcher canManagePreview={false} />);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── Renders all five states when visible ───────────────────────────────────

describe('<PreviewStateSwitcher> — renders the control when canManagePreview is true', () => {
  it('renders the root control and all five state option buttons with correct labels', () => {
    render(<PreviewStateSwitcher canManagePreview={true} />);

    expect(screen.getByTestId('preview-state-switcher')).toBeInTheDocument();

    for (const state of PREVIEW_STATES) {
      const button = screen.getByTestId(`preview-state-switcher-option-${state}`);
      expect(button.tagName.toLowerCase()).toBe('button');
      expect(button).toHaveTextContent(PREVIEW_STATE_LABELS[state]);
    }
  });

  it('shows no active-label or Clear control before any state has been activated', () => {
    render(<PreviewStateSwitcher canManagePreview={true} />);

    expect(screen.queryByTestId('preview-state-switcher-active-label')).toBeNull();
    expect(screen.queryByTestId('preview-state-switcher-clear')).toBeNull();
    expect(screen.queryByTestId('preview-state-switcher-error')).toBeNull();
  });
});

// ─── Activating a preview state (Req 6.2) ───────────────────────────────────

describe('<PreviewStateSwitcher> — activating a preview state', () => {
  it.each(PREVIEW_STATES)(
    'clicking the "%s" option POSTs that state and calls router.refresh() on success',
    async (state) => {
      fetchMock.mockResolvedValueOnce(mockResponse({ ok: true, status: 200, body: { state } }));

      render(<PreviewStateSwitcher canManagePreview={true} />);
      fireEvent.click(screen.getByTestId(`preview-state-switcher-option-${state}`));

      await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('/api/dashboard/preview-state');
      // `withCsrfHeader()` (`@/lib/auth/csrf`) builds this headers object via
      // the real `Headers` API, which normalizes header names to lowercase
      // (`content-type`, not `Content-Type`) — this is the CSRF fix applied
      // in this same task; see PreviewStateSwitcher.tsx's `requestPreviewState()`
      // doc comment. No `x-csrf-token` key appears here because jsdom's
      // `document.cookie` carries no `csrf_token` in this test environment,
      // so `withCsrfHeader()` correctly omits it (falls through) rather than
      // sending an empty/undefined token — the real browser middleware
      // always issues that cookie on page navigation, so this omission is a
      // property of the unit-test environment, not the component.
      expect(init).toEqual({
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state }),
      });

      // The activated option is now marked pressed, and the active-label/
      // Clear affordances appear.
      expect(screen.getByTestId(`preview-state-switcher-option-${state}`)).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByTestId('preview-state-switcher-active-label')).toHaveTextContent(
        `Currently active: ${PREVIEW_STATE_LABELS[state]}`,
      );
      expect(screen.getByTestId('preview-state-switcher-clear')).toBeInTheDocument();
    },
  );
});

// ─── CSRF header regression guard ───────────────────────────────────────────

describe('<PreviewStateSwitcher> — sends the CSRF double-submit header (regression guard)', () => {
  /**
   * This is the regression test for the real bug found and fixed while
   * building Task 14.1's e2e suite: `requestPreviewState()` originally
   * called `fetch()` with no `x-csrf-token` header, so the middleware's
   * CSRF double-submit gate (`@/lib/auth/csrf`) rejected every real click
   * with 403 before the component's own mocked-`fetch` unit tests (which
   * bypass the browser's real header/cookie plumbing entirely) could ever
   * catch it. This test seeds a real `csrf_token` cookie and asserts the
   * component echoes it back in the `x-csrf-token` header via
   * `withCsrfHeader()` — proving the fix, not just the mocked call shape
   * asserted elsewhere in this file (which cannot distinguish "no token
   * available" from "token available but never sent").
   */
  it('echoes the csrf_token cookie value in the x-csrf-token header on POST', async () => {
    document.cookie = 'csrf_token=test-csrf-token-value; Path=/';
    fetchMock.mockResolvedValueOnce(
      mockResponse({ ok: true, status: 200, body: { state: 'filled' } }),
    );

    render(<PreviewStateSwitcher canManagePreview={true} />);
    fireEvent.click(screen.getByTestId('preview-state-switcher-option-filled'));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));

    const [, init] = fetchMock.mock.calls[0]!;
    const sentHeaders = init?.headers as Record<string, string>;
    expect(sentHeaders['x-csrf-token']).toBe('test-csrf-token-value');

    document.cookie = 'csrf_token=; Path=/; Max-Age=0';
  });

  it('echoes the csrf_token cookie value in the x-csrf-token header on DELETE', async () => {
    document.cookie = 'csrf_token=test-csrf-token-value-2; Path=/';
    fetchMock.mockResolvedValueOnce(
      mockResponse({ ok: true, status: 200, body: { state: 'filled' } }),
    );
    render(<PreviewStateSwitcher canManagePreview={true} />);
    fireEvent.click(screen.getByTestId('preview-state-switcher-option-filled'));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));

    fetchMock.mockResolvedValueOnce(mockResponse({ ok: true, status: 204 }));
    fireEvent.click(screen.getByTestId('preview-state-switcher-clear'));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(2));

    const [, deleteInit] = fetchMock.mock.calls[1]!;
    const sentHeaders = deleteInit?.headers as Record<string, string>;
    expect(sentHeaders['x-csrf-token']).toBe('test-csrf-token-value-2');

    document.cookie = 'csrf_token=; Path=/; Max-Age=0';
  });
});

// ─── Clearing an active preview state ───────────────────────────────────────

describe('<PreviewStateSwitcher> — clearing an active preview state', () => {
  it('clicking Clear (after activating a state) calls fetch with DELETE and then router.refresh()', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ ok: true, status: 200, body: { state: 'degraded' } }),
    );
    render(<PreviewStateSwitcher canManagePreview={true} />);

    fireEvent.click(screen.getByTestId('preview-state-switcher-option-degraded'));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));

    const clearButton = screen.getByTestId('preview-state-switcher-clear');
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: true, status: 204 }));
    fireEvent.click(clearButton);

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(2));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('/api/dashboard/preview-state');
    // Same CSRF fix as the POST case above: `withCsrfHeader()` always
    // returns a (possibly empty) headers object; empty here because this
    // test environment's `document.cookie` carries no `csrf_token`.
    expect(init).toEqual({ method: 'DELETE', credentials: 'same-origin', headers: {} });

    // Clearing resets activeState to null: Clear and the active-label both
    // disappear, and no option remains pressed.
    await waitFor(() => expect(screen.queryByTestId('preview-state-switcher-clear')).toBeNull());
    expect(screen.queryByTestId('preview-state-switcher-active-label')).toBeNull();
    for (const state of PREVIEW_STATES) {
      expect(screen.getByTestId(`preview-state-switcher-option-${state}`)).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }
  });
});

// ─── Failed requests degrade gracefully (never throw) ───────────────────────

describe('<PreviewStateSwitcher> — failed requests degrade gracefully', () => {
  it('renders the server-provided message inline and does not call router.refresh() on a failed response', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ ok: false, status: 500, body: { code: 'X', message: 'boom' } }),
    );

    render(<PreviewStateSwitcher canManagePreview={true} />);
    fireEvent.click(screen.getByTestId('preview-state-switcher-option-filled'));

    const errorEl = await screen.findByTestId('preview-state-switcher-error');
    expect(errorEl).toHaveTextContent('boom');
    expect(errorEl).toHaveAttribute('role', 'alert');
    expect(mockRefresh).not.toHaveBeenCalled();

    // A failed activation must not leave the option marked as active.
    expect(screen.getByTestId('preview-state-switcher-option-filled')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.queryByTestId('preview-state-switcher-active-label')).toBeNull();
  });

  it('falls back to a generic message when the failed response has no JSON body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error('no body');
      },
    } as unknown as Response);

    render(<PreviewStateSwitcher canManagePreview={true} />);
    fireEvent.click(screen.getByTestId('preview-state-switcher-option-loading'));

    const errorEl = await screen.findByTestId('preview-state-switcher-error');
    expect(errorEl).toHaveTextContent('Request failed (status 503).');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('renders a graceful inline error (never an uncaught exception) when fetch itself rejects', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));

    render(<PreviewStateSwitcher canManagePreview={true} />);
    expect(() =>
      fireEvent.click(screen.getByTestId('preview-state-switcher-option-error')),
    ).not.toThrow();

    const errorEl = await screen.findByTestId('preview-state-switcher-error');
    expect(errorEl).toHaveTextContent(
      'Could not reach the preview-state endpoint. Check your connection and try again.',
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

// ─── Mount-time cookie read highlights the active state ─────────────────────

describe('<PreviewStateSwitcher> — mount-time active-state read from the cookie', () => {
  it('highlights the matching option and shows the active-label/Clear when a valid cookie is already present on mount', async () => {
    seedPreviewStateCookie('error');

    render(<PreviewStateSwitcher canManagePreview={true} />);

    const activeOption = await screen.findByTestId('preview-state-switcher-option-error');
    expect(activeOption).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('preview-state-switcher-active-label')).toHaveTextContent(
      `Currently active: ${PREVIEW_STATE_LABELS.error}`,
    );
    expect(screen.getByTestId('preview-state-switcher-clear')).toBeInTheDocument();

    // No fetch happens purely from mounting/reading the cookie — this is a
    // client-only convenience read, not a network round trip.
    expect(fetchMock).not.toHaveBeenCalled();

    // Every other option must not be marked pressed.
    for (const state of PREVIEW_STATES) {
      if (state === 'error') continue;
      expect(screen.getByTestId(`preview-state-switcher-option-${state}`)).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }
  });

  it('shows no active state on mount when no cookie is present', () => {
    render(<PreviewStateSwitcher canManagePreview={true} />);

    for (const state of PREVIEW_STATES) {
      expect(screen.getByTestId(`preview-state-switcher-option-${state}`)).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }
    expect(screen.queryByTestId('preview-state-switcher-clear')).toBeNull();
  });
});
