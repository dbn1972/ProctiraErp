import '@testing-library/jest-dom';
import { expect, vi } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';

// V15 — component-level axe for the error surfaces. `packages/ui/components` already
// registers these matchers the same way, and for the same reason: `vitest-axe`'s shipped
// `extend-expect` entry point is empty in this version, so the matchers are wired manually.
//
// Needed here because the E2E axe suite cannot reach these surfaces. `ListLoadFailure`
// renders from a *server* component on a denied read, so `page.route` cannot fabricate the
// 403 that produces it — the fetch never leaves the server. A component scan is the only
// automated evidence available for the panels this audit introduced.
expect.extend(axeMatchers);

// Mock next/navigation — provides default stubs for useRouter, usePathname,
// useSearchParams, and useParams. Individual tests can override via vi.mock()
// if they need custom return values.
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
  // No-op: the real helper only rethrows Next-internal navigation errors.
  unstable_rethrow: vi.fn(),
}));

// jsdom does not implement ResizeObserver, which many UI components rely on.
if (typeof globalThis.ResizeObserver === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

// jsdom does not implement IntersectionObserver
if (typeof globalThis.IntersectionObserver === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).IntersectionObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

// jsdom does not implement matchMedia
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
