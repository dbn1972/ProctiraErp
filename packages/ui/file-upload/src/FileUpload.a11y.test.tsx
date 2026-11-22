import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';

import { FileUpload } from './FileUpload';

/**
 * PRC-L597 — widget-level axe-core WCAG 2.1 AA gate for the `<FileUpload>`
 * primitive. The dev dependency (`vitest-axe`) lands in B00 (PR #693); this
 * batch adds the runtime a11y gate so a future regression in the drop zone's
 * labelling, the accepted-types/size hints or the rejected-file alert list
 * fails CI instead of silently shipping.
 *
 * Regression gate (not failing-first): the widget is already accessible, so
 * these assert the current contract and guard it going forward.
 */
describe('<FileUpload /> — axe-core WCAG 2.1 AA gate (PRC-L597)', () => {
  it('idle drop zone has no violations', async () => {
    const { container } = render(
      <FileUpload onFilesSelected={vi.fn()} ariaLabel="Upload documents" />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('drop zone with accept + size hints has no violations', async () => {
    const { container } = render(
      <FileUpload
        accept={['.pdf', '.xlsx']}
        maxSize={10 * 1024 * 1024}
        maxFiles={3}
        multiple
        onFilesSelected={vi.fn()}
        ariaLabel="Upload supporting documents"
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('disabled drop zone retains an accessible name', async () => {
    const { container } = render(
      <FileUpload disabled onFilesSelected={vi.fn()} ariaLabel="Upload documents" />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
