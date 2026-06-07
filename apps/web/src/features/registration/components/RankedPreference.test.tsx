/**
 * @vitest-environment jsdom
 *
 * RankedPreference unit tests (Task 51.3 / Requirement 16.10).
 *
 * Covers:
 *   • Renders the empty-state hint when there are no preferences.
 *   • Renders one row per preference, in the order the parent provided
 *     them, with the rank badge re-derived from index (so a stale
 *     `rank` field cannot desynchronise from position).
 *   • Removing a row calls `onChange` with the gap closed and ranks
 *     re-derived (1, 2, 3 stays contiguous).
 *   • Keyboard reorder via the dnd-kit keyboard sensor: focus the
 *     drag handle, press Space to grab, ArrowDown to move, Space to
 *     drop. The component reports the new order through `onChange`.
 *   • The live region announces the most recent reorder / removal.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import {
  RankedPreference,
  MAX_RANKED_PREFERENCES,
} from './RankedPreference';
import type { SchoolPreference } from '../schemas';

const A: SchoolPreference = { schoolId: 'a', schoolName: 'Alpha High', rank: 1 };
const B: SchoolPreference = { schoolId: 'b', schoolName: 'Beta High', rank: 2 };
const C: SchoolPreference = { schoolId: 'c', schoolName: 'Gamma High', rank: 3 };

describe('<RankedPreference>', () => {
  it('renders the empty-state hint when given no preferences', () => {
    render(<RankedPreference preferences={[]} onChange={() => undefined} />);
    expect(screen.getByTestId('ranked-preference-empty')).toBeTruthy();
    expect(screen.queryByTestId('ranked-preference-list')).toBeNull();
  });

  it('renders one row per preference in array order', () => {
    render(
      <RankedPreference preferences={[A, B, C]} onChange={() => undefined} />,
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('data-rank'))).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(screen.getByText('Alpha High')).toBeTruthy();
    expect(screen.getByText('Beta High')).toBeTruthy();
    expect(screen.getByText('Gamma High')).toBeTruthy();
  });

  it('re-derives rank from position even when the prop is stale', () => {
    // Pass an array where the stored ranks intentionally do NOT match
    // index (simulating a subtle bug in the parent). The component
    // should ignore the stored `rank` and badge them 1, 2, 3 by
    // position.
    const stale: SchoolPreference[] = [
      { ...B, rank: 1 },
      { ...A, rank: 3 },
      { ...C, rank: 2 },
    ];
    render(<RankedPreference preferences={stale} onChange={() => undefined} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]?.getAttribute('data-rank')).toBe('1');
    expect(rows[0]?.textContent).toContain('Beta High');
    expect(rows[1]?.getAttribute('data-rank')).toBe('2');
    expect(rows[1]?.textContent).toContain('Alpha High');
    expect(rows[2]?.getAttribute('data-rank')).toBe('3');
    expect(rows[2]?.textContent).toContain('Gamma High');
  });

  it('removes a preference and re-derives ranks so the gap closes', () => {
    const onChange = vi.fn();
    render(
      <RankedPreference preferences={[A, B, C]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId('remove-b'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as SchoolPreference[];
    // B is gone, A and C close the gap with re-derived ranks.
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual({ ...A, rank: 1 });
    expect(next[1]).toEqual({ ...C, rank: 2 });
  });

  it('respects the disabled flag on drag handle and remove button', () => {
    render(
      <RankedPreference
        preferences={[A, B]}
        onChange={() => undefined}
        disabled
      />,
    );
    const handle = screen.getByTestId('drag-handle-a') as HTMLButtonElement;
    const removeButton = screen.getByTestId('remove-a') as HTMLButtonElement;
    expect(handle.disabled).toBe(true);
    expect(removeButton.disabled).toBe(true);
  });

  it('exposes a polite live region for screen-reader announcements', () => {
    render(
      <RankedPreference preferences={[A, B, C]} onChange={() => undefined} />,
    );
    const live = screen.getByTestId('ranked-preference-live-region');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.getAttribute('role')).toBe('status');
  });

  it('announces removals through the live region', () => {
    function Wrapper() {
      const [items, setItems] = (
        require('react') as typeof import('react')
      ).useState<SchoolPreference[]>([A, B, C]);
      return <RankedPreference preferences={items} onChange={setItems} />;
    }
    render(<Wrapper />);
    fireEvent.click(screen.getByTestId('remove-b'));
    const live = screen.getByTestId('ranked-preference-live-region');
    expect(live.textContent).toContain('Removed Beta High');
  });

  it('exposes MAX_RANKED_PREFERENCES = 3 (Requirement 16 AC 10)', () => {
    expect(MAX_RANKED_PREFERENCES).toBe(3);
  });

  it('reorders preferences via the keyboard sensor (Space + ArrowDown + Space)', () => {
    function Wrapper() {
      const [items, setItems] = (
        require('react') as typeof import('react')
      ).useState<SchoolPreference[]>([A, B, C]);
      return <RankedPreference preferences={items} onChange={setItems} />;
    }
    render(<Wrapper />);

    const handleA = screen.getByTestId('drag-handle-a');
    handleA.focus();
    expect(document.activeElement).toBe(handleA);

    // dnd-kit's KeyboardSensor activates on Space or Enter and uses
    // sortableKeyboardCoordinates to compute the next position from
    // arrow keys. Drop on the second Space/Enter.
    fireEvent.keyDown(handleA, { key: ' ', code: 'Space' });
    fireEvent.keyDown(handleA, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.keyDown(handleA, { key: ' ', code: 'Space' });

    // Verify the rendered order is now B, A, C.
    const rows = screen.getAllByRole('listitem');
    const order = rows.map((row) => row.textContent ?? '');
    expect(order[0]).toContain('Beta High');
    expect(order[1]).toContain('Alpha High');
    expect(order[2]).toContain('Gamma High');

    // Live region announces the drop after the move.
    const live = screen.getByTestId('ranked-preference-live-region');
    expect(live.textContent).toContain('Alpha High');
  });
});
