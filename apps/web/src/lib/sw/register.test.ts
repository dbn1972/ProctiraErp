/**
 * @vitest-environment jsdom
 *
 * registerServiceWorker — Task 60.5 / Requirements 38.1, 38.4
 *
 * Covers the gating logic for the SW registration helper. The
 * helper is the single source of truth that the `<ServiceWorkerRegister>`
 * shim and (eventually) a SPA `main.tsx` bootstrap delegate to.
 *
 * The tests rely entirely on the option overrides exposed by the
 * helper — no globals are monkey-patched — so they remain
 * independent of jsdom's evolving navigator surface.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  DEFAULT_SW_SCRIPT_URL,
  registerServiceWorker,
} from './register';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setNodeEnv(value: string): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) {
    delete (process.env as Record<string, string | undefined>).NODE_ENV;
  } else {
    (process.env as Record<string, string | undefined>).NODE_ENV =
      ORIGINAL_NODE_ENV;
  }
});

describe('registerServiceWorker — production registers /sw.js', () => {
  it('calls register() with the default URL when all gates pass', () => {
    const register = vi.fn().mockResolvedValue({});

    const result = registerServiceWorker({
      isProduction: true,
      isSecureContext: true,
      register,
    });

    expect(result).toEqual({
      status: 'registered',
      scriptUrl: DEFAULT_SW_SCRIPT_URL,
    });
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(DEFAULT_SW_SCRIPT_URL);
  });

  it('respects an explicit scriptUrl override', () => {
    const register = vi.fn().mockResolvedValue({});

    const result = registerServiceWorker({
      isProduction: true,
      isSecureContext: true,
      register,
      scriptUrl: '/custom-sw.js',
    });

    expect(result).toEqual({ status: 'registered', scriptUrl: '/custom-sw.js' });
    expect(register).toHaveBeenCalledWith('/custom-sw.js');
  });
});

describe('registerServiceWorker — gating', () => {
  it('skips registration outside production by default', () => {
    setNodeEnv('development');
    const register = vi.fn();

    const result = registerServiceWorker({
      isSecureContext: true,
      register,
    });

    expect(result).toEqual({ status: 'skipped-non-production' });
    expect(register).not.toHaveBeenCalled();
  });

  it('skips registration when not in a secure context', () => {
    const register = vi.fn();

    const result = registerServiceWorker({
      isProduction: true,
      isSecureContext: false,
      register,
    });

    expect(result).toEqual({ status: 'skipped-insecure-context' });
    expect(register).not.toHaveBeenCalled();
  });

  it('skips registration when navigator.serviceWorker is unavailable', () => {
    // jsdom does not implement `serviceWorker` by default, so
    // simply not providing a `register` override exercises the
    // unsupported-API branch.
    expect('serviceWorker' in navigator).toBe(false);

    const result = registerServiceWorker({
      isProduction: true,
      isSecureContext: true,
    });

    expect(result).toEqual({ status: 'skipped-unsupported' });
  });
});

describe('registerServiceWorker — failure handling', () => {
  it('routes registration rejections to onRegistrationError', async () => {
    const error = new Error('boom');
    const rejection = Promise.reject(error);
    rejection.catch(() => {}); // suppress unhandled-rejection noise
    const register = vi.fn().mockReturnValue(rejection);
    const onRegistrationError = vi.fn();

    const result = registerServiceWorker({
      isProduction: true,
      isSecureContext: true,
      register,
      onRegistrationError,
    });

    expect(result).toEqual({
      status: 'registered',
      scriptUrl: DEFAULT_SW_SCRIPT_URL,
    });

    // Allow the catch handler to run.
    await rejection.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onRegistrationError).toHaveBeenCalledTimes(1);
    expect(onRegistrationError).toHaveBeenCalledWith(error);
  });

  it('falls back to console.warn when no error sink is provided', async () => {
    const error = new Error('boom');
    const rejection = Promise.reject(error);
    rejection.catch(() => {});
    const register = vi.fn().mockReturnValue(rejection);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    registerServiceWorker({
      isProduction: true,
      isSecureContext: true,
      register,
    });

    await rejection.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warn).toHaveBeenCalledWith('[sw] registration failed', error);
  });
});
