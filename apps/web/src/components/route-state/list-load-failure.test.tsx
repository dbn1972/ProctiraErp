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

  it('renders at h2 so it does not skip a level under the page h1', () => {
    // An h3 directly under the page h1 is an axe heading-order violation, and nothing in
    // CI catches it: lint:a11y only checks icon-only buttons.
    render(<ListLoadFailure kind="denied" />);
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('ships a way to sign in for the one kind whose copy asks the user to', () => {
    render(<ListLoadFailure kind="unauthenticated" returnTo="/health" />);
    const link = screen.getByRole('link', { name: /sign in/i });
    expect(link).toHaveAttribute('href', '/login?next=%2Fhealth');
  });

  it('does not offer a sign-in control for the other kinds', () => {
    for (const kind of ['denied', 'missing', 'unavailable'] as ListFailureKind[]) {
      const { unmount } = render(<ListLoadFailure kind={kind} />);
      expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
      unmount();
    }
  });

  it('still quotes a network failure, whose status is 0', () => {
    // A truthiness check would hide the reference line for exactly the case
    // classifyListFailure documents 0 for.
    render(<ListLoadFailure kind="unavailable" status={0} />);
    expect(screen.getByText(/HTTP 0/)).toBeInTheDocument();
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

  // ─── V15 — retry control and request id ───────────────────────────────────

  it('ships a retry control for the kind whose copy asks the user to retry', () => {
    // The `unavailable` copy said "Reload the page to try again" and shipped no control.
    render(<ListLoadFailure kind="unavailable" status={503} />);
    expect(screen.getByTestId('list-load-failure-retry')).toBeInTheDocument();
  });

  it('does not offer retry for the kinds where retrying cannot help', () => {
    // Retrying a denial or a route that is not served re-runs a request whose answer will
    // not change, so offering it would be misleading.
    for (const kind of ['unauthenticated', 'denied', 'missing'] as ListFailureKind[]) {
      const { unmount } = render(<ListLoadFailure kind={kind} />);
      expect(screen.queryByTestId('list-load-failure-retry')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('shows the gateway request id so support can find the one log line', () => {
    render(
      <ListLoadFailure kind="unavailable" status={503} requestId="0f9c1d4e-77a2-4c1b-9f55-1" />,
    );
    expect(screen.getByTestId('failure-request-id')).toHaveTextContent(
      'Request ID: 0f9c1d4e-77a2-4c1b-9f55-1',
    );
  });

  it('omits the request id line when the gateway did not supply one', () => {
    // A network reject never reaches the gateway, so there is no id to show — and an
    // empty "Request ID:" label would send the user to support with nothing.
    render(<ListLoadFailure kind="unavailable" status={0} />);
    expect(screen.queryByTestId('failure-request-id')).not.toBeInTheDocument();
  });
});
