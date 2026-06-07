/**
 * @vitest-environment jsdom
 *
 * Task 56.7 — component-level axe-core gate for `<Dialog>`.
 *
 * Modal dialogs are the most regression-prone surface for WCAG 2.1 AA
 * compliance: missing `aria-labelledby`, focus traps that fail to
 * include the close button, or a backdrop with insufficient contrast
 * are all common violations. We mount a fully-populated dialog (header,
 * description, footer with two buttons) and run axe against the
 * portal-rendered tree.
 *
 * Validates: Requirements 37.7, 37.8
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './Dialog';
import { Button } from './Button';

beforeAll(() => {
  // Radix's Dialog uses ResizeObserver to position the close button.
  // jsdom doesn't ship one, so we install a no-op shim before any
  // dialog renders.
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
  }
});

describe('<Dialog /> — axe-core WCAG 2.1 AA gate', () => {
  it('open dialog with title + description has no violations', async () => {
    render(
      <Dialog defaultOpen>
        <DialogTrigger asChild>
          <Button>Open dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm enrollment</DialogTitle>
            <DialogDescription>
              This will enroll the student for the upcoming academic
              period and notify the homeroom teacher.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline">Cancel</Button>
            <Button>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );

    // The dialog renders into a portal, so we scan the entire document
    // body (which includes the portal mount point) rather than the
    // initial container.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();

    const results = await axe(document.body);
    expect(results).toHaveNoViolations();
  });
});
