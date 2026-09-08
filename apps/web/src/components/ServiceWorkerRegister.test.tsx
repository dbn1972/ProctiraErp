/**
 * @vitest-environment jsdom
 *
 * <ServiceWorkerRegister> tests — Task 60.5 / Requirement 38.1, 38.4
 *
 * Covers the registration shim that boots `/sw.js` once the React tree
 * hydrates. The component is intentionally tiny — it renders nothing
 * and only calls `navigator.serviceWorker.register()` — so the tests
 * concentrate on the gating logic:
 *
 *   • Registers the SW in production, with the default URL.
 *   • Honours the `scriptUrl` prop override (test-only seam).
 *   • No-op when `process.env.NODE_ENV !== 'production'` (so `next dev`
 *     HMR is not interfered with and Playwright runs stay isolated).
 *   • No-op when `navigator.serviceWorker` is unavailable (older
 *     browsers, file:// origins, private modes).
 *   • Swallows registration failures with a console.warn so a SW
 *     outage never throws into the React tree.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

import { ServiceWorkerRegister } from './ServiceWorkerRegister';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setNodeEnv(value: string): void {
  // Node 22+ rejects Object.defineProperty against process.env, so we
  // mutate it via a plain assignment after casting through unknown to
  // bypass the readonly typing.
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

function restoreNodeEnv(): void {
  if (ORIGINAL_NODE_ENV === undefined) {
    delete (process.env as Record<string, string | undefined>).NODE_ENV;
  } else {
    (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_NODE_ENV;
  }
}

function installServiceWorkerMock(register: ReturnType<typeof vi.fn>) {
  // jsdom does not implement navigator.serviceWorker, so we attach our
  // own mock. The descriptor is `configurable: true` so afterEach can
  // remove it and restore the original (undefined) shape.
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register },
  });
}

function removeServiceWorkerMock() {
  // Re-define as undefined and then delete via Object.defineProperty
  // so the next test re-installs the mock cleanly.
  if ('serviceWorker' in navigator) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (navigator as any).serviceWorker;
  }
}

const ORIGINAL_IS_SECURE_CONTEXT = Object.getOwnPropertyDescriptor(window, 'isSecureContext');

function setSecureContext(value: boolean): void {
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value,
  });
}

function restoreSecureContext(): void {
  if (ORIGINAL_IS_SECURE_CONTEXT) {
    Object.defineProperty(window, 'isSecureContext', ORIGINAL_IS_SECURE_CONTEXT);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).isSecureContext;
  }
}

beforeEach(() => {
  removeServiceWorkerMock();
  // The helper requires a secure context. jsdom's default may not
  // expose `isSecureContext` so we stamp it explicitly.
  setSecureContext(true);
  vi.restoreAllMocks();
});

afterEach(() => {
  // Guard against tests that mutate NODE_ENV without cleaning up.
  restoreNodeEnv();
  removeServiceWorkerMock();
  restoreSecureContext();
});

// ─── Production registration ─────────────────────────────────────────────────

describe('<ServiceWorkerRegister> in production', () => {
  beforeEach(() => {
    setNodeEnv('production');
  });

  it('registers /sw.js by default', () => {
    const register = vi.fn().mockResolvedValue({});
    installServiceWorkerMock(register);

    render(<ServiceWorkerRegister />);

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('/sw.js');
  });

  it('honours an explicit scriptUrl override', () => {
    const register = vi.fn().mockResolvedValue({});
    installServiceWorkerMock(register);

    render(<ServiceWorkerRegister scriptUrl="/custom-sw.js" />);

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('/custom-sw.js');
  });

  it('renders no DOM', () => {
    const register = vi.fn().mockResolvedValue({});
    installServiceWorkerMock(register);

    const { container } = render(<ServiceWorkerRegister />);
    expect(container.childNodes.length).toBe(0);
  });

  it('logs a warning when registration rejects (non-fatal)', async () => {
    const rejection = Promise.reject(new Error('boom'));
    // Suppress unhandled-rejection noise — the component owns the catch.
    rejection.catch(() => {});
    const register = vi.fn().mockReturnValue(rejection);
    installServiceWorkerMock(register);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<ServiceWorkerRegister />);

    // Allow the component's `.catch(...)` chain to settle. We wait
    // on the rejection itself plus a microtask so the catch handler
    // has run before we assert.
    await rejection.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(register).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0]?.[0]).toBe('[sw] registration failed');
  });
});

// ─── Non-production short circuit ────────────────────────────────────────────

describe('<ServiceWorkerRegister> outside production', () => {
  it('does not register in development', () => {
    setNodeEnv('development');
    const register = vi.fn();
    installServiceWorkerMock(register);

    render(<ServiceWorkerRegister />);

    expect(register).not.toHaveBeenCalled();
  });

  it('does not register in test', () => {
    setNodeEnv('test');
    const register = vi.fn();
    installServiceWorkerMock(register);

    render(<ServiceWorkerRegister />);

    expect(register).not.toHaveBeenCalled();
  });
});

// ─── Browser without ServiceWorker support ───────────────────────────────────

describe('<ServiceWorkerRegister> on browsers without serviceWorker', () => {
  it('is a no-op when navigator.serviceWorker is absent', () => {
    setNodeEnv('production');
    // Do not install the mock — `'serviceWorker' in navigator` should be false.
    expect('serviceWorker' in navigator).toBe(false);

    expect(() => render(<ServiceWorkerRegister />)).not.toThrow();
  });
});
