/**
 * @vitest-environment jsdom
 *
 * Application Tracking page tests (Task 51.4).
 *
 * Covers:
 *   • form validation: empty tracking number is rejected client-side
 *   • PRC-H029: the applicant DOB is required and forwarded to the fetcher
 *   • happy path: a 200 response renders the status badge, institution,
 *     remarks, waitlist position and booked interviews
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
import { ApplicationTracking, type TrackingFetcher } from './application-tracking';

const messages = enMessages as unknown as Record<string, Record<string, string>>;

function renderWithLang(node: React.ReactNode) {
  return render(
    <LanguageProvider defaultLocale="en" messagesByLocale={{ en: messages }}>
      {node}
    </LanguageProvider>,
  );
}

const DOB = '2012-03-15';

function fillAndSubmit(value: string, dob: string = DOB) {
  const input = screen.getByLabelText(messages.tracking!.trackingNumberLabel!);
  const dobInput = screen.getByLabelText(messages.tracking!.dateOfBirthLabel!);
  // fireEvent.change updates `input.value` and dispatches the synthetic
  // event React expects, without us having to poke the value setter
  // ourselves (which trips the unbound-method lint rule).
  act(() => {
    fireEvent.change(input, { target: { value } });
    fireEvent.change(dobInput, { target: { value: dob } });
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
    renderWithLang(<ApplicationTracking fetcher={fetcher as unknown as TrackingFetcher} />);

    const submit = screen.getByRole('button', {
      name: messages.tracking!.checkStatus!,
    });
    act(() => {
      fireEvent.click(submit);
    });

    await waitFor(() => {
      expect(screen.getByText(messages.tracking!.trackingNumberRequired!)).toBeTruthy();
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
      expect(screen.getByText(messages.tracking!.trackingNumberRequired!)).toBeTruthy();
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires the applicant date of birth (PRC-H029)', async () => {
    const fetcher = vi.fn();
    renderWithLang(<ApplicationTracking fetcher={fetcher as unknown as TrackingFetcher} />);
    fillAndSubmit('REG-A1B2C3D4', '');
    await waitFor(() => {
      expect(screen.getByText(messages.tracking!.dateOfBirthRequired!)).toBeTruthy();
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('ApplicationTracking — successful lookup', () => {
  it('renders status, institution, remarks, waitlist and interviews on 200', async () => {
    const fetcher: TrackingFetcher = vi.fn(async () => ({
      kind: 'ok' as const,
      data: {
        trackingNumber: 'REG-A1B2C3D4',
        status: 'waitlisted',
        institutionName: 'Sunrise Public School',
        submittedAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-03T00:00:00Z',
        remarks: 'Documents verified',
        waitlistPosition: 4,
        interviewBookings: [{ id: 'b1', slotId: 's1', status: 'booked' }],
      },
    }));

    renderWithLang(<ApplicationTracking fetcher={fetcher} />);
    fillAndSubmit('REG-A1B2C3D4');

    await waitFor(() => {
      expect(screen.getByTestId('tracking-result')).toBeTruthy();
    });
    expect(screen.getByTestId('status-badge').textContent).toBe(
      messages.tracking!.statusWaitlisted!,
    );
    expect(screen.getByText('Sunrise Public School')).toBeTruthy();
    expect(screen.getByTestId('tracking-remarks').textContent).toBe('Documents verified');
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByTestId('interviews-booked').textContent).toContain('1');
    expect(fetcher).toHaveBeenCalledWith('REG-A1B2C3D4', DOB);
  });

  it('renders an empty-state message when no interview is booked', async () => {
    const fetcher: TrackingFetcher = vi.fn(async () => ({
      kind: 'ok' as const,
      data: {
        trackingNumber: 'REG-EMPTY',
        status: 'pending',
        submittedAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        interviewBookings: [],
      },
    }));

    renderWithLang(<ApplicationTracking fetcher={fetcher} />);
    fillAndSubmit('REG-EMPTY');

    await waitFor(() => {
      expect(screen.getByTestId('interviews-empty')).toBeTruthy();
    });
    expect(screen.queryByTestId('tracking-remarks')).toBeNull();
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
    expect(screen.getByText(messages.tracking!.notFoundTitle!)).toBeTruthy();
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
          interviewBookings: [],
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
