import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ForbiddenPage from './page';

// Denied console access is not written to the audit log yet (follow-up
// FU-T1-E), so the page must not tell operators that it was.
describe('ForbiddenPage', () => {
  it('names the area and makes no audit-log claim', async () => {
    const html = renderToStaticMarkup(
      await ForbiddenPage({ searchParams: Promise.resolve({ area: 'billing' }) }),
    );
    expect(html).toContain('Access denied');
    expect(html).toContain('billing');
    expect(html).not.toMatch(/audit log/i);
  });
});
