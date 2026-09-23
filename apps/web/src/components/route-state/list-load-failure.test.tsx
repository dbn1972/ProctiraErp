/**
 * `ListLoadFailure` — distinct copy per failure kind.
 *
 * The point of the component is that the four kinds do not read the same. A single
 * "could not load" message would be no more actionable than the "No records found" it
 * replaces, so the test asserts they differ rather than just that something renders.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ListFailureKind } from '@/lib/api/list-result';

import { ListLoadFailure } from './list-load-failure';

const KINDS: ListFailureKind[] = ['unauthenticated', 'denied', 'missing', 'unavailable'];

describe('ListLoadFailure', () => {
  it('tells the user what to do differently for each kind', () => {
    const headings = new Set<string>();
    for (const kind of KINDS) {
      const { unmount } = render(<ListLoadFailure kind={kind} />);
      const panel = screen.getByTestId('list-load-failure');
      expect(panel).toHaveAttribute('data-failure-kind', kind);
      headings.add(screen.getByRole('heading').textContent ?? '');
      unmount();
    }
    // Four kinds, four distinct messages.
    expect(headings.size).toBe(KINDS.length);
  });

  it('names the access boundary for a denial rather than implying no data', () => {
    render(<ListLoadFailure kind="denied" status={403} />);
    expect(screen.getByRole('heading')).toHaveTextContent(/do not have access/i);
    // A support conversation can start from a fact.
    expect(screen.getByText(/HTTP 403/)).toBeInTheDocument();
  });

  it('uses a polite live region, not an assertive one', () => {
    // This renders during ordinary page load; role="alert" would interrupt a
    // screen-reader user mid-navigation.
    render(<ListLoadFailure kind="unavailable" />);
    const panel = screen.getByTestId('list-load-failure');
    expect(panel).toHaveAttribute('role', 'status');
  });

  it('omits the reference line when there is no status to quote', () => {
    render(<ListLoadFailure kind="unavailable" />);
    expect(screen.queryByText(/HTTP/)).not.toBeInTheDocument();
  });
});
