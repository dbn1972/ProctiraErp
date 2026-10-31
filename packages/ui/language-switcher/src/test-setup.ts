import '@testing-library/jest-dom';
import { expect } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';

// PRC-L597: register the vitest-axe matchers once for the whole suite so the
// widget-level axe gate can call `expect(results).toHaveNoViolations()`.
// `vitest-axe`'s shipped `extend-expect` entry is empty in this version, so
// the matchers are wired in manually (same pattern as packages/ui/components).
expect.extend(axeMatchers);
