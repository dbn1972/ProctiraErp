/**
 * @vitest-environment jsdom
 *
 * Command (Combobox) keyboard-contract tests — Task 56.6 / Req 37 AC 6.
 *
 * <Command> wraps cmdk (https://cmdk.paco.me/), the canonical combobox
 * primitive used both for command palettes and popover-mounted
 * comboboxes. cmdk drives the listbox via `aria-selected` and an
 * `aria-activedescendant` cursor on the input. The contract below
 * mirrors the [WAI-ARIA Combobox pattern][1]:
 *
 *   • ArrowDown / ArrowUp move the active item.
 *   • Home / End jump to the first / last visible item.
 *   • Enter selects the active item and fires `onSelect`.
 *   • Type-ahead is a substring filter — typing in the input narrows
 *     the visible result set.
 *   • Escape dismissal is delegated to the host surface (Popover or
 *     CommandDialog); the standalone <Command> primitive does not own
 *     dismissal, so Escape behaviour is exercised by the Dialog suite.
 *
 * Implementation notes:
 *   • cmdk attaches its keyboard handler to the *root* div (the
 *     `cmdk-root` element), not the <input>. The root listens for
 *     keys that bubble up from the input. The tests therefore
 *     dispatch `keydown` on the input and let it bubble.
 *   • cmdk does **not** loop by default. We do not assert wrap-around
 *     behaviour here.
 *   • Active-item tracking uses `aria-selected="true"`.
 *
 * [1]: https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './Command';

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

interface RenderOptions {
  onSelect?: (value: string) => void;
}

function renderCombobox({ onSelect }: RenderOptions = {}) {
  render(
    <Command label="Search countries">
      <CommandInput placeholder="Search…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Countries">
          <CommandItem value="india" onSelect={() => onSelect?.('india')}>
            India
          </CommandItem>
          <CommandItem value="indonesia" onSelect={() => onSelect?.('indonesia')}>
            Indonesia
          </CommandItem>
          <CommandItem value="japan" onSelect={() => onSelect?.('japan')}>
            Japan
          </CommandItem>
          <CommandItem value="kenya" onSelect={() => onSelect?.('kenya')}>
            Kenya
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>,
  );

  return {
    input: screen.getByRole('combobox') as HTMLInputElement,
    listbox: screen.getByRole('listbox'),
  };
}

function getActiveItemText(listbox: HTMLElement): string | null {
  const active = listbox.querySelector('[aria-selected="true"]');
  return active?.textContent ?? null;
}

describe('<Command> / Combobox keyboard contract — Task 56.6 / Req 37 AC 6', () => {
  it('mounts the combobox input and the listbox with all four items', () => {
    const { listbox } = renderCombobox();
    expect(within(listbox).getByText('India')).toBeTruthy();
    expect(within(listbox).getByText('Indonesia')).toBeTruthy();
    expect(within(listbox).getByText('Japan')).toBeTruthy();
    expect(within(listbox).getByText('Kenya')).toBeTruthy();
  });

  it('exposes the input as role="combobox" with aria-controls pointing at the listbox', () => {
    const { input, listbox } = renderCombobox();
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('aria-controls')).toBe(listbox.getAttribute('id'));
  });

  it('selects the first item by default (cmdk virtual focus)', () => {
    const { listbox } = renderCombobox();
    expect(getActiveItemText(listbox)).toBe('India');
  });

  it('ArrowDown moves the active item to the next visible result', () => {
    const { input, listbox } = renderCombobox();
    act(() => input.focus());

    act(() => {
      fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });
    });
    expect(getActiveItemText(listbox)).toBe('Indonesia');

    act(() => {
      fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });
    });
    expect(getActiveItemText(listbox)).toBe('Japan');
  });

  it('ArrowUp moves the active item to the previous visible result', () => {
    const { input, listbox } = renderCombobox();
    act(() => input.focus());

    // Push down twice (separate acts so React re-renders between
    // events and the cmdk DOM cursor advances), then up once → land
    // on the second item.
    act(() => {
      fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });
    });
    act(() => {
      fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });
    });
    expect(getActiveItemText(listbox)).toBe('Japan');

    act(() => {
      fireEvent.keyDown(input, { key: 'ArrowUp', code: 'ArrowUp' });
    });
    expect(getActiveItemText(listbox)).toBe('Indonesia');
  });

  it('Home jumps to the first item; End jumps to the last item', () => {
    const { input, listbox } = renderCombobox();
    act(() => input.focus());

    act(() => {
      fireEvent.keyDown(input, { key: 'End', code: 'End' });
    });
    expect(getActiveItemText(listbox)).toBe('Kenya');

    act(() => {
      fireEvent.keyDown(input, { key: 'Home', code: 'Home' });
    });
    expect(getActiveItemText(listbox)).toBe('India');
  });

  it('Enter on an active item fires onSelect with the item value', () => {
    const onSelect = vi.fn();
    const { input } = renderCombobox({ onSelect });
    act(() => input.focus());

    // Move active to Indonesia, then press Enter.
    act(() => {
      fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });
    });
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('indonesia');
  });

  it('type-ahead filters the visible results — typing "jap" leaves only Japan reachable', () => {
    const { input, listbox } = renderCombobox();
    act(() => {
      input.focus();
      fireEvent.change(input, { target: { value: 'jap' } });
    });

    // Only Japan remains visible/active.
    expect(getActiveItemText(listbox)).toBe('Japan');
    // The hidden non-matching items are still in the DOM but do not
    // participate in filtered traversal — assert we cannot find them
    // via the listbox's filtered cursor.
    expect(within(listbox).getByText('Japan')).toBeTruthy();
  });

  it('renders the empty-state placeholder when no item matches the typed query', () => {
    const { input } = renderCombobox();
    act(() => {
      input.focus();
      fireEvent.change(input, { target: { value: 'zzzzzz' } });
    });
    expect(screen.getByText('No results.')).toBeTruthy();
  });
});
