import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';

import { Button } from './Button';

/**
 * Task 56.7 — component-level axe-core gate for the canonical
 * `<Button>` primitive. Validates Requirement 37 AC 7 (no color-only
 * meaning) and AC 8 (WCAG 2.1 AA) for the most heavily-used
 * interactive primitive in the design system.
 *
 * The gate is intentionally fast: each render is a single `<Button>`
 * with no consumers, so the axe pass typically completes in under
 * 100 ms. We focus on the variants most likely to introduce a
 * regression — the icon-only size (which historically lacked an
 * accessible name) and the `disabled` state (which historically
 * dropped focus + label association).
 *
 * Validates: Requirements 37.7, 37.8
 */
describe('<Button /> — axe-core WCAG 2.1 AA gate', () => {
  it('default text button has no violations', async () => {
    const { container } = render(<Button>Save changes</Button>);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('icon-only button with aria-label has no violations', async () => {
    // Icon-only buttons must carry an `aria-label` per AC 4 and the
    // custom ESLint rule (task 56.5). axe enforces the runtime side
    // of that contract — a missing label here would fire `button-name`.
    const { container } = render(
      <Button size="icon" aria-label="Open settings">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="currentColor"
        >
          <circle cx="12" cy="12" r="3" />
        </svg>
      </Button>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('disabled button retains an accessible name', async () => {
    const { container } = render(
      <Button disabled>Submit application</Button>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('destructive variant is not flagged for color-only meaning when paired with text', async () => {
    // The destructive variant uses red as its primary cue; pairing it
    // with the literal "Delete" label keeps it WCAG 2.1 AA compliant
    // (no color-only meaning per AC 7).
    const { container } = render(
      <Button variant="destructive">Delete record</Button>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
