/**
 * @vitest-environment jsdom
 *
 * <NotificationPreferences> tests — Task 60A.11.
 *
 * Covers:
 *   • Initial GET → page renders with persisted preferences.
 *   • Per-channel toggle: toggling a switch marks the form dirty and
 *     the save button becomes enabled.
 *   • Happy-path submit: clicking "Save" issues PATCH with the full
 *     preferences payload.
 *   • Quiet hours: enabling quiet hours reveals time inputs and day
 *     toggles.
 *
 * Validates: Requirements 22.1, 22.2, 22.4, 22.5
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { LanguageProvider } from '@/providers/LanguageProvider';
import type { NotificationPreferencesData } from '@/lib/api/notifications';

// ─── jsdom shims ─────────────────────────────────────────────────────────

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
}
const proto = Element.prototype as unknown as Record<string, unknown>;
if (!('hasPointerCapture' in proto)) proto['hasPointerCapture'] = () => false;
if (!('releasePointerCapture' in proto))
  proto['releasePointerCapture'] = () => undefined;
if (!('scrollIntoView' in proto)) proto['scrollIntoView'] = () => undefined;

// ─── Mocks ───────────────────────────────────────────────────────────────

vi.mock('@/lib/api/notifications', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/notifications')>(
    '@/lib/api/notifications',
  );
  return {
    ...actual,
    getNotificationPreferences: vi.fn(),
    updateNotificationPreferences: vi.fn(),
  };
});

import * as notificationsApi from '@/lib/api/notifications';
import NotificationPreferences from '../pages/NotificationPreferences';

// ─── i18n messages ───────────────────────────────────────────────────────

const messages = {
  common: { loading: 'Loading…' },
  settings: {
    notifications: {
      title: 'Notification Preferences',
      description: 'Configure how and when you receive notifications.',
      save: 'Save changes',
      saving: 'Saving…',
      saveSuccess: 'Preferences saved.',
      saveSuccessTitle: 'Saved',
      saveFailedTitle: 'Save failed',
      saveFailed: 'Could not save preferences.',
      loadFailedTitle: 'Could not load preferences',
      loadFailed: 'Could not load preferences.',
      toggleLabel: '{category} via {channel}',
      channels: {
        email: 'Email',
        in_app: 'In-App',
        push: 'Push',
        webhook: 'Webhook',
      },
      categories: {
        title: 'Notification Categories',
        description: 'Choose which channels to use for each category.',
        academic: 'Academic',
        attendance: 'Attendance',
        examination: 'Examination',
        workflow: 'Workflow',
        system: 'System',
      },
      digest: {
        title: 'Digest Frequency',
        description: 'How often to receive notification digests.',
        frequencyLabel: 'Frequency',
        immediate: 'Immediate',
        daily: 'Daily',
        weekly: 'Weekly',
      },
      quietHours: {
        title: 'Quiet Hours',
        description: 'Suppress notifications during specific hours.',
        enableLabel: 'Enable quiet hours',
        startTime: 'Start time',
        endTime: 'End time',
        daysLabel: 'Active days',
        days: {
          '0': 'Sunday',
          '1': 'Monday',
          '2': 'Tuesday',
          '3': 'Wednesday',
          '4': 'Thursday',
          '5': 'Friday',
          '6': 'Saturday',
        },
        daysShort: {
          '0': 'Sun',
          '1': 'Mon',
          '2': 'Tue',
          '3': 'Wed',
          '4': 'Thu',
          '5': 'Fri',
          '6': 'Sat',
        },
      },
    },
  },
};

// ─── Sample data ─────────────────────────────────────────────────────────

const SAMPLE_PREFERENCES: NotificationPreferencesData = {
  categories: [
    { category: 'academic', channels: { email: true, in_app: true, push: true, webhook: false } },
    { category: 'attendance', channels: { email: true, in_app: true, push: false, webhook: false } },
    { category: 'examination', channels: { email: true, in_app: true, push: true, webhook: false } },
    { category: 'workflow', channels: { email: true, in_app: true, push: false, webhook: true } },
    { category: 'system', channels: { email: true, in_app: true, push: true, webhook: false } },
  ],
  digestFrequency: 'immediate',
  quietHours: {
    enabled: false,
    startTime: '22:00',
    endTime: '07:00',
    days: [0, 1, 2, 3, 4, 5, 6],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────

function renderPage() {
  return render(
    <LanguageProvider
      defaultLocale="en"
      messagesByLocale={{ en: messages }}
    >
      <NotificationPreferences />
    </LanguageProvider>,
  );
}

// ─── Setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(notificationsApi.getNotificationPreferences).mockResolvedValue({
    ...SAMPLE_PREFERENCES,
  });
  vi.mocked(notificationsApi.updateNotificationPreferences).mockImplementation(
    async (patch) => ({ ...SAMPLE_PREFERENCES, ...patch } as NotificationPreferencesData),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────

describe('<NotificationPreferences>', () => {
  it('renders the preferences page after loading', async () => {
    renderPage();

    // Loading skeleton goes away once the GET resolves.
    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
    });

    expect(screen.getByTestId('notification-preferences')).toBeTruthy();

    // Category rows are rendered.
    expect(screen.getByTestId('category-row-academic')).toBeTruthy();
    expect(screen.getByTestId('category-row-attendance')).toBeTruthy();
    expect(screen.getByTestId('category-row-examination')).toBeTruthy();
    expect(screen.getByTestId('category-row-workflow')).toBeTruthy();
    expect(screen.getByTestId('category-row-system')).toBeTruthy();

    // Save button is disabled until the form is dirty.
    expect(
      (screen.getByTestId('notification-prefs-submit') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('enables the save button when a channel toggle is changed', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
    });

    const toggle = screen.getByTestId('toggle-academic-email');
    act(() => {
      fireEvent.click(toggle);
    });

    expect(
      (screen.getByTestId('notification-prefs-submit') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('submits a PATCH with the full preferences payload', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
    });

    // Toggle a channel to make the form dirty.
    const toggle = screen.getByTestId('toggle-attendance-push');
    act(() => {
      fireEvent.click(toggle);
    });

    const submitBtn = screen.getByTestId('notification-prefs-submit') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(notificationsApi.updateNotificationPreferences).toHaveBeenCalledTimes(1);
    });

    const [payload] = vi.mocked(notificationsApi.updateNotificationPreferences).mock.calls[0]!;
    // The attendance push channel should now be toggled on (was false).
    const attendanceCat = payload.categories?.find((c) => c.category === 'attendance');
    expect(attendanceCat?.channels.push).toBe(true);

    // Success banner appears.
    await waitFor(() => {
      expect(screen.queryByTestId('notification-prefs-success')).not.toBeNull();
    });
  });

  it('reveals quiet hours configuration when enabled', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
    });

    // Quiet hours time inputs should not be visible initially (disabled).
    expect(screen.queryByTestId('quiet-hours-start')).toBeNull();

    // Enable quiet hours.
    const enableToggle = screen.getByTestId('quiet-hours-enabled');
    act(() => {
      fireEvent.click(enableToggle);
    });

    // Time inputs and day buttons should now be visible.
    expect(screen.getByTestId('quiet-hours-start')).toBeTruthy();
    expect(screen.getByTestId('quiet-hours-end')).toBeTruthy();
    expect(screen.getByTestId('quiet-hours-day-0')).toBeTruthy();
    expect(screen.getByTestId('quiet-hours-day-6')).toBeTruthy();
  });

  it('shows an error alert when loading fails', async () => {
    vi.mocked(notificationsApi.getNotificationPreferences).mockRejectedValue(
      new Error('Network error'),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
    });

    // Error alert should be visible.
    expect(screen.getByText('Network error')).toBeTruthy();
  });
});
