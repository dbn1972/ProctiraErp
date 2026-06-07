/**
 * @vitest-environment jsdom
 *
 * Tabs keyboard-contract tests — Task 56.6 / Requirement 37 AC 6.
 *
 * Validates that the canonical ProctiraERP <Tabs> primitive (built on
 * @radix-ui/react-tabs and @radix-ui/react-roving-focus) honours the
 * [WAI-ARIA Tabs pattern][1]:
 *
 *   • Roving tabindex: only the active trigger has tabindex=0; the
 *     others have tabindex=-1.
 *   • ArrowRight / ArrowLeft step through triggers and wrap.
 *   • Home / End jump to the first / last trigger.
 *   • In automatic activation mode (default), focus → activation, so
 *     the associated panel appears as the user navigates.
 *
 * [1]: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
 *
 * Note on async timing — Radix's roving-focus group schedules the
 * focus shift inside a `setTimeout(..., 0)`, so each interaction
 * test runs with `vi.useFakeTimers()` and flushes the queue with
 * `vi.runAllTimers()` after dispatching the key.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { Tabs, TabsList, TabsTrigger, TabsContent } from './Tabs';

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
  }
  Element.prototype.hasPointerCapture =
    Element.prototype.hasPointerCapture ?? (() => false);
  Element.prototype.scrollIntoView =
    Element.prototype.scrollIntoView ?? (() => {});
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

function renderThreeTabs() {
  render(
    <Tabs defaultValue="alpha">
      <TabsList aria-label="Demo tablist">
        <TabsTrigger value="alpha">Alpha</TabsTrigger>
        <TabsTrigger value="beta">Beta</TabsTrigger>
        <TabsTrigger value="gamma">Gamma</TabsTrigger>
      </TabsList>
      <TabsContent value="alpha">Alpha panel</TabsContent>
      <TabsContent value="beta">Beta panel</TabsContent>
      <TabsContent value="gamma">Gamma panel</TabsContent>
    </Tabs>,
  );

  return {
    alpha: screen.getByRole('tab', { name: 'Alpha' }),
    beta: screen.getByRole('tab', { name: 'Beta' }),
    gamma: screen.getByRole('tab', { name: 'Gamma' }),
  };
}

/**
 * Dispatch a keydown on the currently active element and flush
 * Radix's `setTimeout(focus, 0)` so focus assertions can run
 * synchronously.
 */
function pressKey(target: Element, key: string) {
  act(() => {
    fireEvent.keyDown(target, { key, code: key });
  });
  act(() => {
    vi.runAllTimers();
  });
}

describe('<Tabs> keyboard contract — Task 56.6 / Req 37 AC 6', () => {
  it('mounts a tablist with three triggers and three panels', () => {
    const { alpha, beta, gamma } = renderThreeTabs();
    expect(alpha).toBeTruthy();
    expect(beta).toBeTruthy();
    expect(gamma).toBeTruthy();
    expect(screen.getByRole('tablist', { name: 'Demo tablist' })).toBeTruthy();
  });

  it('Tab order: once a tab receives focus, only that tab participates in the document tab sequence (roving tabindex)', () => {
    const { alpha, beta, gamma } = renderThreeTabs();

    // Radix's roving focus assigns the active tabindex on first focus
    // entry — the group div is the keyboard entry point, then focus is
    // delegated to a child. Simulate that by focusing the active
    // trigger directly.
    act(() => alpha.focus());

    expect(alpha.getAttribute('tabindex')).toBe('0');
    expect(beta.getAttribute('tabindex')).toBe('-1');
    expect(gamma.getAttribute('tabindex')).toBe('-1');
  });

  it('ArrowRight from the active tab moves focus AND activation to the next tab', () => {
    const { alpha, beta } = renderThreeTabs();

    act(() => alpha.focus());
    expect(document.activeElement).toBe(alpha);

    pressKey(alpha, 'ArrowRight');

    expect(document.activeElement).toBe(beta);
    // Automatic activation is the default — the panel for the focused
    // tab is rendered.
    expect(beta.getAttribute('data-state')).toBe('active');
    expect(screen.getByText('Beta panel')).toBeTruthy();
  });

  it('ArrowLeft from the active tab moves focus to the previous tab and wraps from the first', () => {
    const { alpha, beta, gamma } = renderThreeTabs();

    act(() => beta.focus());
    pressKey(beta, 'ArrowLeft');
    expect(document.activeElement).toBe(alpha);

    // Wrap: ArrowLeft on the first tab lands on the last.
    pressKey(alpha, 'ArrowLeft');
    expect(document.activeElement).toBe(gamma);
  });

  it('ArrowRight wraps from the last tab back to the first', () => {
    const { alpha, gamma } = renderThreeTabs();

    act(() => gamma.focus());
    pressKey(gamma, 'ArrowRight');
    expect(document.activeElement).toBe(alpha);
  });

  it('Home jumps to the first tab; End jumps to the last tab', () => {
    const { alpha, beta, gamma } = renderThreeTabs();

    act(() => beta.focus());

    pressKey(beta, 'End');
    expect(document.activeElement).toBe(gamma);

    pressKey(gamma, 'Home');
    expect(document.activeElement).toBe(alpha);
  });
});
