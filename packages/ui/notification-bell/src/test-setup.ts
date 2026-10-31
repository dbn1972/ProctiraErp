import '@testing-library/jest-dom';
import { expect } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';

// PRC-L597: register the vitest-axe matchers once for the whole suite so the
// widget-level axe gate can call `expect(results).toHaveNoViolations()`.
// `vitest-axe`'s shipped `extend-expect` entry is empty in this version, so
// the matchers are wired in manually (same pattern as packages/ui/components).
expect.extend(axeMatchers);

// jsdom does not implement window.matchMedia. Provide a minimal stub so
// components that consume `useReducedMotion` render in tests.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    }),
  });
}
