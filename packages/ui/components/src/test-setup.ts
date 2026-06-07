import '@testing-library/jest-dom';
import { expect } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';

// Wire vitest-axe matchers into Vitest's `expect` once for the whole
// suite. Tests can then call `expect(results).toHaveNoViolations()`
// after running `axe(container)` from `vitest-axe`.
//
// Note: `vitest-axe`'s shipped `extend-expect` entry point is empty in
// this version, so we register the matchers manually here.
//
// Task 56.7 — axe-core matchers for component-level a11y tests.
expect.extend(axeMatchers);
