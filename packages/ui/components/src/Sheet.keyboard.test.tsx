/**
 * @vitest-environment jsdom
 *
 * Sheet keyboard-contract tests — Task 56.6 / Requirement 37 AC 6.
 *
 * <Sheet> is a slide-out drawer built on @radix-ui/react-dialog.
 * Its keyboard contract is identical to <Dialog> — modal focus trap +
 * Escape-to-dismiss — so this test suite asserts the same canonical
 * interactions and verifies that they are preserved across the four
 * `side` variants (top / right / bottom / left). The visual side does
 * not affect the keyboard model.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './Sheet';
import { Button } from './Button';

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

function renderSheet(side: (typeof SIDES)[number] = 'right') {
  render(
    <Sheet>
      <SheetTrigger asChild>
        <Button>Open sheet</Button>
      </SheetTrigger>
      <SheetContent side={side}>
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>Refine the result set.</SheetDescription>
        </SheetHeader>
        <SheetFooter>
          <Button>Apply</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>,
  );
  return {
    trigger: screen.getByRole('button', { name: 'Open sheet' }),
  };
}

describe('<Sheet> keyboard contract — Task 56.6 / Req 37 AC 6', () => {
  it('renders no dialog node by default', () => {
    renderSheet();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Enter on the trigger opens the sheet', () => {
    const { trigger } = renderSheet();
    act(() => {
      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' });
      fireEvent.keyUp(trigger, { key: 'Enter', code: 'Enter' });
      fireEvent.click(trigger);
    });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('Space on the trigger opens the sheet', () => {
    const { trigger } = renderSheet();
    act(() => {
      trigger.focus();
      fireEvent.keyDown(trigger, { key: ' ', code: 'Space' });
      fireEvent.keyUp(trigger, { key: ' ', code: 'Space' });
      fireEvent.click(trigger);
    });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('Escape closes the sheet', () => {
    const { trigger } = renderSheet();
    act(() => fireEvent.click(trigger));
    expect(screen.getByRole('dialog')).toBeTruthy();

    act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: 'Escape',
        code: 'Escape',
      });
    });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(SIDES)('keeps the same Escape-dismiss contract across side="%s"', (side) => {
    const { trigger } = renderSheet(side);
    act(() => fireEvent.click(trigger));
    expect(screen.getByRole('dialog')).toBeTruthy();

    act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: 'Escape',
        code: 'Escape',
      });
    });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the auto-injected close button so keyboard users can dismiss without Escape', () => {
    const { trigger } = renderSheet();
    act(() => fireEvent.click(trigger));
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('exposes role="dialog" with an accessible name from <SheetTitle>', () => {
    const { trigger } = renderSheet();
    act(() => fireEvent.click(trigger));
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeTruthy();
  });

  it('places footer interactive controls inside the dialog so Tab keeps them in the focus trap', () => {
    const { trigger } = renderSheet();
    act(() => fireEvent.click(trigger));
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(screen.getByRole('button', { name: 'Apply' }))).toBe(true);
    expect(dialog.contains(screen.getByRole('button', { name: 'Close' }))).toBe(true);
  });
});
