/**
 * @vitest-environment jsdom
 *
 * Task 56.7 — component-level axe-core gate for `<Select>`.
 *
 * The shadcn/ui `<Select>` family wraps `@radix-ui/react-select`, which
 * is well-tested for ARIA correctness, but consumers must still pair
 * the trigger with an accessible name. This gate covers the closed-
 * state surface a user sees on the form: trigger, label association,
 * and placeholder text. The expanded popover is portaled and uses
 * `requestAnimationFrame` for positioning so we keep this test fast
 * by scanning only the form chrome.
 *
 * Validates: Requirements 37.7, 37.8
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from './Select';
import { Label } from './Label';

describe('<Select /> — axe-core WCAG 2.1 AA gate', () => {
  it('select trigger paired with <Label htmlFor> has no violations', async () => {
    const { container } = render(
      <div>
        <Label htmlFor="grade">Grade level</Label>
        <Select>
          <SelectTrigger id="grade">
            <SelectValue placeholder="Select a grade" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Primary</SelectLabel>
              <SelectItem value="1">Grade 1</SelectItem>
              <SelectItem value="2">Grade 2</SelectItem>
              <SelectItem value="3">Grade 3</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('select trigger with aria-label only is also accessible', async () => {
    const { container } = render(
      <Select>
        <SelectTrigger aria-label="Select institution">
          <SelectValue placeholder="Pick one…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Institution A</SelectItem>
          <SelectItem value="b">Institution B</SelectItem>
        </SelectContent>
      </Select>,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
