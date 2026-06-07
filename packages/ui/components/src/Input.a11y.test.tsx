import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';

import { Input, Textarea } from './Input';
import { Label } from './Label';

/**
 * Task 56.7 — component-level axe-core gate for `<Input>` and
 * `<Textarea>`. Form controls that lack a programmatic label are the
 * single most common AC 4 (label pairing) regression, so we cover both
 * the explicit `<Label htmlFor>` pattern and the implicit
 * `aria-label` escape hatch.
 *
 * Validates: Requirements 37.7, 37.8
 */
describe('<Input /> + <Textarea /> — axe-core WCAG 2.1 AA gate', () => {
  it('input paired with <Label htmlFor> has no violations', async () => {
    const { container } = render(
      <div>
        <Label htmlFor="email">Email address</Label>
        <Input id="email" type="email" name="email" />
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('input with aria-label only is also accessible', async () => {
    const { container } = render(
      <Input aria-label="Search students" type="search" />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('disabled input retains label association', async () => {
    const { container } = render(
      <div>
        <Label htmlFor="readonly-field">Tracking ID</Label>
        <Input id="readonly-field" disabled value="REG-A1B2C3D4" readOnly />
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('textarea paired with <Label htmlFor> has no violations', async () => {
    const { container } = render(
      <div>
        <Label htmlFor="notes">Additional notes</Label>
        <Textarea id="notes" name="notes" rows={4} />
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
