import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import CompliancePage from '../compliance/page';
import SecurityPage from './page';

describe('public trust claims (PRC-H017)', () => {
  it('qualifies certification and avoids unsupported absolute security guarantees', () => {
    const html = `${renderToStaticMarkup(createElement(SecurityPage))}${renderToStaticMarkup(
      createElement(CompliancePage),
    )}`;

    expect(html).toContain('ISO 27001 control alignment (not certified)');
    expect(html).toContain('deployment-specific evidence is available on request');
    expect(html).not.toContain('Cross-tenant access is impossible');
    expect(html).not.toContain('Every read of sensitive student data and every write is recorded');
    expect(html).not.toContain('>ISO 27001<');
  });
});
