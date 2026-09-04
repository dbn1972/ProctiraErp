/**
 * @vitest-environment jsdom
 *
 * Application Tracking page tests (Task 51.4).
 *
 * Covers:
 *   • form validation: empty tracking number is rejected client-side
 *   • happy path: a 200 response renders the status badge, history
 *     timeline, and follow-up actions
 *   • 404 path: renders the friendly "Application not found" alert
 *   • 5xx / network error path: renders the retry alert
 *   • all user-facing copy is sourced from `useLanguage().t()` (Requirement
 *     16.6 — no PII beyond what was submitted, no hardcoded brand strings)
 */

import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { LanguageProvider } from '@/providers/LanguageProvider';
import enMessages from '@/messages/en.json';
import {
  ApplicationTracking,
  type TrackingFetcher,
} from './application-tracking';

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/track',
}));

const messages = enMessages as unknown as Record<
  string,
  Record<string, string>
>;

function renderWithLang(node: React.ReactNode) {
  return render(
    <LanguageProvider
      defaultLocale="en"
      messagesByLocale={{ en: messages }}
    >
      {node}
    </LanguageProvider>,
  );
}

function fillAndSubmit(value: string) {
  const input = screen.getByLabelText(
    messages.tracking!.trackingNumberLabel!,
  );
  // fireEvent.change updates `input.value` and dispatches the synthetic
  // event React expects, without us having to poke the value setter
  // ourselves (which trips the unbound-method lint rule).
  act(() => {
    fireEvent.change(input, { target: { value } });
  });
  const submit = screen.getByRole('button', {
    name: messages.tracking!.checkStatus!,
  });
  act(() => {
    fireEvent.click(submit);
  });
}

describe('ApplicationTracking — form validation', () => {
  it('rejects an empty tracking number without invoking the fetcher', async () => {
    const fetcher = vi.fn();
    renderWithLang(
      <ApplicationTracking fetcher={fetcher as unknown as TrackingFetcher} />,
    );

    const submit = screen.getByRole('button', {
      name: messages.tracking!.checkStatus!,
    });
    act(() => {
      fireEvent.click(submit);
    });

    await waitFor(() => {
      expect(
        screen.getByText(messages.tracking!.trackingNumberRequired!),
      ).toBeTruthy();
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only input', async () => {
    const fetcher = vi.fn();
    renderWithLang(
      <ApplicationTracking
        fetcher={fetcher as unknown as TrackingFetcher}
        initialTrackingNumber="   "
      />,
    );
    fillAndSubmit('   ');
    await waitFor(() => {
      expect(
        screen.getByText(messages.tracking!.trackingNumberRequired!),
      ).toBeTruthy();
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('ApplicationTracking — successful lookup', () => {
  it('renders the status badge, history timeline, and follow-up actions on 200', async () => {
    const fetcher: TrackingFetcher = vi.fn(async () => ({
      kind: 'ok' as const,
      data: {
        trackingNumber: 'REG-A1B2C3D4',
        status: 'under_review',
        currentStep: 'Document review',
        submittedAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-03T00:00:00Z',
        history: [
          {
            status: 'pending',
            timestamp: '2025-01-01T00:00:00Z',
            note: 'Application received',
          },
          {
            status: 'under_review',
            timestamp: '2025-01-03T00:00:00Z',
            note: 'Documents being verified',
          },
        ],
        followUpActions: [
          {
            code: 'UPLOAD_BIRTH_CERT',
            message: 'Please upload a birth certificate',
          },
        ],
      },
    }));

    renderWithLang(<ApplicationTracking fetcher={fetcher} />);
    fillAndSubmit('REG-A1B2C3D4');

    await waitFor(() => {
      expect(screen.getByTestId('tracking-result')).toBeTruthy();
    });

    // Status badge shows the localized "Under review" label.
    const badge = screen.getByTestId('status-badge');
    expect(badge.textContent).toBe(messages.tracking!.statusUnderReview!);

    // Both history entries are rendered.
    const items = screen.getAllByTestId('timeline-item');
    expect(items).toHaveLength(2);

    // Timestamp <time> elements expose the ISO date as `dateTime`.
    const times = items[0]!.querySelectorAll('time');
    expect(times[0]!.getAttribute('dateTime')).toMatch(/2025-01-/);

    // Notes from history entries are visible.
    expect(screen.getByText('Application received')).toBeTruthy();
    expect(screen.getByText('Documents being verified')).toBeTruthy();

    // Follow-up action message is visible.
    expect(
      screen.getByText('Please upload a birth certificate'),
    ).toBeTruthy();

    // The fetcher was called with the tracking number from the form.
    expect(fetcher).toHaveBeenCalledWith('REG-A1B2C3D4');
  });

  it('renders an empty-state message when there is no history or follow-up', async () => {
    const fetcher: TrackingFetcher = vi.fn(async () => ({
      kind: 'ok' as const,
      data: {
        trackingNumber: 'REG-EMPTY',
        status: 'pending',
        submittedAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        history: [],
        followUpActions: [],
      },
    }));

    renderWithLang(<ApplicationTracking fetcher={fetcher} />);
    fillAndSubmit('REG-EMPTY');

    await waitFor(() => {
      expect(screen.getByTestId('history-empty')).toBeTruthy();
    });
    expect(screen.getByTestId('follow-up-empty')).toBeTruthy();
  });
});

describe('ApplicationTracking — error handling', () => {
  it('shows the friendly "not found" alert on a 404 response', async () => {
    const fetcher: TrackingFetcher = vi.fn(async () => ({ kind: 'not_found' as const }));
    renderWithLang(<ApplicationTracking fetcher={fetcher} />);
    fillAndSubmit('REG-MISSING');

    await waitFor(() => {
      expect(screen.getByTestId('tracking-not-found')).toBeTruthy();
    });
    expect(
      screen.getByText(messages.tracking!.notFoundTitle!),
    ).toBeTruthy();
    // The user-supplied tracking number is shown so they can correct it.
    expect(screen.getByText('#REG-MISSING')).toBeTruthy();
  });

  it('shows the retry alert on a generic error and re-runs the fetch on click', async () => {
    let calls = 0;
    const fetcher: TrackingFetcher = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return { kind: 'error' as const, message: 'boom' };
      return {
        kind: 'ok' as const,
        data: {
          trackingNumber: 'REG-RETRY',
          status: 'approved',
          submittedAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-02T00:00:00Z',
          history: [],
          followUpActions: [],
        },
      };
    });

    renderWithLang(<ApplicationTracking fetcher={fetcher} />);
    fillAndSubmit('REG-RETRY');

    await waitFor(() => {
      expect(screen.getByTestId('tracking-error')).toBeTruthy();
    });

    const retryButton = screen.getByRole('button', {
      name: messages.tracking!.retry!,
    });
    act(() => {
      fireEvent.click(retryButton);
    });

    await waitFor(() => {
      expect(screen.getByTestId('tracking-result')).toBeTruthy();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
