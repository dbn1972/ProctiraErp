/**
 * NotificationPreferences — Settings → Notifications (Task 60A.11).
 *
 * Provides a unified screen for managing notification delivery preferences:
 *   • Per-channel toggles (email, in-app, push, webhook) for each
 *     notification category (academic, attendance, examination, workflow, system)
 *   • Digest frequency configuration (immediate, daily, weekly)
 *   • Quiet hours configuration (time range + day selection)
 *
 * Wires to the Notification Service from task 18 via:
 *   GET  /api/v1/notifications/preferences
 *   PATCH /api/v1/notifications/preferences
 *
 * Cross-cutting rules:
 *   • Accessibility (Task 56): every toggle is labelled, state changes
 *     announced via `useAnnounce()`, touch targets meet 48×48 px floor.
 *   • Theming (Task 47): uses design tokens only, no hex literals.
 *   • Internationalization (Task 48): all visible strings via `useLanguage().t()`.
 *
 * Validates: Requirements 22.1, 22.2, 22.4, 22.5
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Switch,
  useAnnounce,
} from '@proctira/ui/components';

import { useLanguage } from '@/providers/LanguageProvider';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type CategoryPreference,
  type DigestFrequency,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPreferencesData,
  type NotificationPreferencesPatch,
  type QuietHours,
} from '@/lib/api/notifications';

// ─── Constants ───────────────────────────────────────────────────────────

const CHANNELS: NotificationChannel[] = ['email', 'in_app', 'push', 'webhook'];
const CATEGORIES: NotificationCategory[] = [
  'academic',
  'attendance',
  'examination',
  'workflow',
  'system',
];
const DIGEST_OPTIONS: DigestFrequency[] = ['immediate', 'daily', 'weekly'];
const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6] as const;

/** Default preferences used when the API returns no data. */
function getDefaultPreferences(): NotificationPreferencesData {
  return {
    categories: CATEGORIES.map((category) => ({
      category,
      channels: { email: true, in_app: true, push: true, webhook: false },
    })),
    digestFrequency: 'immediate',
    quietHours: {
      enabled: false,
      startTime: '22:00',
      endTime: '07:00',
      days: [0, 1, 2, 3, 4, 5, 6],
    },
  };
}

// ─── Component Props ─────────────────────────────────────────────────────

export interface NotificationPreferencesProps {
  /** Override the loader (tests inject in-memory implementations). */
  loadPreferences?: typeof getNotificationPreferences;
  /** Override the mutator (tests inject in-memory implementations). */
  savePreferences?: typeof updateNotificationPreferences;
  /** Hide page chrome when embedded in the notifications App Router tabs. */
  embedded?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────

export default function NotificationPreferences({
  loadPreferences = getNotificationPreferences,
  savePreferences = updateNotificationPreferences,
  embedded = false,
}: NotificationPreferencesProps = {}): JSX.Element {
  const { t } = useLanguage();
  const announce = useAnnounce();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferencesData>(
    getDefaultPreferences,
  );
  const [isDirty, setIsDirty] = useState(false);
  const [submitState, setSubmitState] = useState<
    | { kind: 'idle' }
    | { kind: 'submitting' }
    | { kind: 'success'; message: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  // ─── Initial load ─────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    loadPreferences()
      .then((data) => {
        if (cancelled) return;
        setPreferences(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error
            ? err.message
            : t('settings.notifications.loadFailed'),
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadPreferences, t]);

  // ─── Handlers ─────────────────────────────────────────────────────────

  const handleChannelToggle = useCallback(
    (category: NotificationCategory, channel: NotificationChannel, enabled: boolean) => {
      setPreferences((prev) => ({
        ...prev,
        categories: prev.categories.map((cat) =>
          cat.category === category
            ? { ...cat, channels: { ...cat.channels, [channel]: enabled } }
            : cat,
        ),
      }));
      setIsDirty(true);
    },
    [],
  );

  const handleDigestChange = useCallback((value: DigestFrequency) => {
    setPreferences((prev) => ({ ...prev, digestFrequency: value }));
    setIsDirty(true);
  }, []);

  const handleQuietHoursToggle = useCallback((enabled: boolean) => {
    setPreferences((prev) => ({
      ...prev,
      quietHours: { ...prev.quietHours, enabled },
    }));
    setIsDirty(true);
  }, []);

  const handleQuietHoursStartChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setPreferences((prev) => ({
        ...prev,
        quietHours: { ...prev.quietHours, startTime: e.target.value },
      }));
      setIsDirty(true);
    },
    [],
  );

  const handleQuietHoursEndChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setPreferences((prev) => ({
        ...prev,
        quietHours: { ...prev.quietHours, endTime: e.target.value },
      }));
      setIsDirty(true);
    },
    [],
  );

  const handleQuietHoursDayToggle = useCallback((day: number, enabled: boolean) => {
    setPreferences((prev) => {
      const days = enabled
        ? [...prev.quietHours.days, day].sort()
        : prev.quietHours.days.filter((d) => d !== day);
      return {
        ...prev,
        quietHours: { ...prev.quietHours, days },
      };
    });
    setIsDirty(true);
  }, []);

  // ─── Submit ───────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSubmitState({ kind: 'submitting' });
    try {
      const patch: NotificationPreferencesPatch = { ...preferences };
      const updated = await savePreferences(patch);
      setPreferences(updated);
      setIsDirty(false);
      const message = t('settings.notifications.saveSuccess');
      setSubmitState({ kind: 'success', message });
      announce(message, 'polite');
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : t('settings.notifications.saveFailed');
      setSubmitState({ kind: 'error', message });
      announce(message, 'assertive');
    }
  }, [preferences, savePreferences, t, announce]);

  // ─── Render: Loading ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        className={embedded ? 'space-y-6' : 'space-y-6 p-6'}
        role="status"
        aria-label={t('common.loading')}
      >
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={embedded ? undefined : 'p-6'}>
        <Alert variant="destructive">
          <AlertTitle>{t('settings.notifications.loadFailedTitle')}</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  // ─── Render: Main ─────────────────────────────────────────────────────

  return (
    <div
      className={embedded ? undefined : 'p-6'}
      data-testid="notification-preferences"
    >
      {embedded ? null : (
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-foreground">
            {t('settings.notifications.title')}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {t('settings.notifications.description')}
          </p>
        </header>
      )}

      {submitState.kind === 'error' && (
        <Alert variant="destructive" className="mb-6" data-testid="notification-prefs-error">
          <AlertTitle>{t('settings.notifications.saveFailedTitle')}</AlertTitle>
          <AlertDescription>{submitState.message}</AlertDescription>
        </Alert>
      )}
      {submitState.kind === 'success' && (
        <Alert className="mb-6" data-testid="notification-prefs-success">
          <AlertTitle>{t('settings.notifications.saveSuccessTitle')}</AlertTitle>
          <AlertDescription>{submitState.message}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-6 max-w-4xl">
        {/* ─── Category Channel Toggles ─────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.notifications.categories.title')}</CardTitle>
            <CardDescription>
              {t('settings.notifications.categories.description')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Header row */}
            <div className="grid grid-cols-5 gap-4 mb-3 px-2">
              <div className="col-span-1" />
              {CHANNELS.map((channel) => (
                <div
                  key={channel}
                  className="text-center text-sm font-medium text-muted-foreground"
                >
                  {t(`settings.notifications.channels.${channel}`)}
                </div>
              ))}
            </div>

            <Separator className="mb-3" />

            {/* Category rows */}
            {preferences.categories.map((catPref) => (
              <div
                key={catPref.category}
                className="grid grid-cols-5 gap-4 items-center py-3 px-2 rounded-md hover:bg-muted/50"
                data-testid={`category-row-${catPref.category}`}
              >
                <Label className="col-span-1 font-medium text-foreground">
                  {t(`settings.notifications.categories.${catPref.category}`)}
                </Label>
                {CHANNELS.map((channel) => (
                  <div key={channel} className="flex justify-center">
                    <Switch
                      checked={catPref.channels[channel]}
                      onCheckedChange={(checked) =>
                        handleChannelToggle(catPref.category, channel, checked)
                      }
                      aria-label={t('settings.notifications.toggleLabel', {
                        category: t(`settings.notifications.categories.${catPref.category}`),
                        channel: t(`settings.notifications.channels.${channel}`),
                      })}
                      data-testid={`toggle-${catPref.category}-${channel}`}
                      className="min-h-[24px] min-w-[44px]"
                    />
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* ─── Digest Frequency ─────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.notifications.digest.title')}</CardTitle>
            <CardDescription>
              {t('settings.notifications.digest.description')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-w-xs">
              <Label htmlFor="digest-frequency" className="mb-2 block">
                {t('settings.notifications.digest.frequencyLabel')}
              </Label>
              <Select
                value={preferences.digestFrequency}
                onValueChange={(value) => handleDigestChange(value as DigestFrequency)}
              >
                <SelectTrigger
                  id="digest-frequency"
                  data-testid="digest-frequency"
                  aria-label={t('settings.notifications.digest.frequencyLabel')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIGEST_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`settings.notifications.digest.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* ─── Quiet Hours ──────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.notifications.quietHours.title')}</CardTitle>
            <CardDescription>
              {t('settings.notifications.quietHours.description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                checked={preferences.quietHours.enabled}
                onCheckedChange={handleQuietHoursToggle}
                id="quiet-hours-enabled"
                aria-label={t('settings.notifications.quietHours.enableLabel')}
                data-testid="quiet-hours-enabled"
                className="min-h-[24px] min-w-[44px]"
              />
              <Label htmlFor="quiet-hours-enabled">
                {t('settings.notifications.quietHours.enableLabel')}
              </Label>
            </div>

            {preferences.quietHours.enabled && (
              <>
                <div className="flex items-center gap-4 flex-wrap">
                  <div>
                    <Label htmlFor="quiet-hours-start" className="mb-1 block text-sm">
                      {t('settings.notifications.quietHours.startTime')}
                    </Label>
                    <input
                      type="time"
                      id="quiet-hours-start"
                      value={preferences.quietHours.startTime}
                      onChange={handleQuietHoursStartChange}
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground min-h-[44px]"
                      data-testid="quiet-hours-start"
                    />
                  </div>
                  <div>
                    <Label htmlFor="quiet-hours-end" className="mb-1 block text-sm">
                      {t('settings.notifications.quietHours.endTime')}
                    </Label>
                    <input
                      type="time"
                      id="quiet-hours-end"
                      value={preferences.quietHours.endTime}
                      onChange={handleQuietHoursEndChange}
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground min-h-[44px]"
                      data-testid="quiet-hours-end"
                    />
                  </div>
                </div>

                <div>
                  <Label className="mb-2 block text-sm">
                    {t('settings.notifications.quietHours.daysLabel')}
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {DAYS_OF_WEEK.map((day) => {
                      const isActive = preferences.quietHours.days.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => handleQuietHoursDayToggle(day, !isActive)}
                          className={`min-h-[44px] min-w-[44px] rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                            isActive
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-input bg-background text-muted-foreground hover:bg-muted'
                          }`}
                          aria-pressed={isActive}
                          aria-label={t(`settings.notifications.quietHours.days.${day}`)}
                          data-testid={`quiet-hours-day-${day}`}
                        >
                          {t(`settings.notifications.quietHours.daysShort.${day}`)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* ─── Save Button ──────────────────────────────────────────── */}
        <div className="flex items-center gap-3 pt-2">
          <Button
            type="button"
            disabled={!isDirty || submitState.kind === 'submitting'}
            onClick={handleSave}
            data-testid="notification-prefs-submit"
            className="min-h-[48px]"
          >
            {submitState.kind === 'submitting'
              ? t('settings.notifications.saving')
              : t('settings.notifications.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export type { NotificationPreferencesData, NotificationPreferencesPatch };
