import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import HomePage from './page';

/**
 * PRC-M472: the homepage must not present fabricated usage metrics (student /
 * school counts, attendance %) as real pilot data.
 */
describe('homepage honesty (PRC-M472)', () => {
  it('does not render fabricated pilot metrics', () => {
    const html = renderToStaticMarkup(createElement(HomePage));
    expect(html).not.toContain('24,812');
    expect(html).not.toContain('schools live in the pilot deployment');
    expect(html).not.toContain('students managed every day');
    expect(html).not.toContain('96.4%');
    expect(html).not.toContain('Illustrative figures from a pilot deployment preview');
  });
});
