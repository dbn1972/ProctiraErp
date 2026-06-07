/**
 * SettingsGeneral — Settings → General (Task 59.1).
 *
 * Form fields per Requirement 42 AC 1 and Requirement 43:
 *   • Brand_Name (1–40 chars; non-empty)
 *   • Default UI language (one of the tenant's supported locales)
 *   • Default Theme_Mode (`light` | `dark` | `system`)
 *   • Notifications email (RFC-style validated)
 *   • Tenant timezone (IANA name)
 *
 * On submit the page issues `PATCH /api/v1/tenant/settings`. The gateway
 * forwards the diff to the Tenant Service from task 40.1, which persists
 * the values in `tenant_settings` (Charter §6, Design §R) and returns the
 * merged record.
 *
 * Cross-cutting rules applied here:
 *   • Accessibility (Task 56): every control is associated with a
 *     `<Label htmlFor>` via `<FormField>`, error text is wired through
 *     `aria-describedby`, save/error states are announced via the global
 *     `<LiveRegion>` (`useAnnounce()`), and the form button targets meet
 *     the 48 × 48 px touch floor.
 *   • Theming (Task 47): copy uses design tokens (`text-foreground`,
 *     `text-muted-foreground`, `text-destructive`); no hex literals.
 *   • Internationalization (Task 48): every visible string flows through
 *     `useLanguage().t()` with explicit fallback (Requirement 18 AC 9).
 *
 * Validates: Requirements 42.1, 43.1, 43.6.
 */
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  FormField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  useAnnounce,
} from '@proctira/ui/components';

import {
  AdminApiError,
  getTenantGeneralSettings,
  updateTenantGeneralSettings,
  type TenantGeneralSettings,
  type TenantGeneralSettingsPatch,
} from '@/lib/api/admin';
import { SUPPORTED_LOCALES, useLanguage } from '@/providers/LanguageProvider';

// ─── Validation schema ───────────────────────────────────────────────────

/**
 * Returns a non-empty list of IANA timezones. Modern engines expose
 * `Intl.supportedValuesOf('timeZone')`; older engines fall back to a
 * minimal regional set so the combobox always has at least the common
 * defaults.
 */
function getSupportedTimezones(): readonly string[] {
  type IntlWithSupportedValues = typeof Intl & {
    supportedValuesOf?: (key: 'timeZone') => string[];
  };
  const intl = Intl as IntlWithSupportedValues;
  if (typeof intl.supportedValuesOf === 'function') {
    try {
      const all = intl.supportedValuesOf('timeZone');
      if (Array.isArray(all) && all.length > 0) return all;
    } catch {
      /* fall through */
    }
  }
  // Fallback: a small but useful set covering deployment regions.
  return [
    'UTC',
    'Africa/Cairo',
    'America/Chicago',
    'America/Los_Angeles',
    'America/New_York',
    'America/Sao_Paulo',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Shanghai',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Australia/Sydney',
    'Europe/Berlin',
    'Europe/London',
    'Europe/Paris',
  ];
}

const themeModeValues = ['light', 'dark', 'system'] as const;

/**
 * The validation schema is built lazily per render so the localized
 * error messages can flow through `t()`. Required for Requirement 18 AC
 * 9 (every visible string sourced from the language catalog).
 */
function buildSchema(t: (key: string, params?: Record<string, string | number>) => string) {
  return z.object({
    brandName: z
      .string()
      .trim()
      .min(1, t('settings.general.errors.brandNameRequired'))
      .max(40, t('settings.general.errors.brandNameTooLong')),
    defaultLanguage: z
      .string()
      .min(1, t('settings.general.errors.defaultLanguageRequired')),
    defaultThemeMode: z.enum(themeModeValues),
    notificationsEmail: z
      .string()
      .trim()
      .min(1, t('settings.general.errors.notificationsEmailRequired'))
      .email(t('settings.general.errors.notificationsEmailInvalid'))
      .max(254),
    tenantTimezone: z
      .string()
      .min(1, t('settings.general.errors.tenantTimezoneRequired')),
  });
}

type SettingsGeneralFormValues = z.infer<ReturnType<typeof buildSchema>>;

// ─── Component ───────────────────────────────────────────────────────────

interface SettingsGeneralProps {
  /**
   * Override the loader / mutator. Tests inject in-memory implementations
   * so the page stays decoupled from `fetch`. Production callers leave
   * these unset and the module-level helpers run.
   */
  loadSettings?: typeof getTenantGeneralSettings;
  saveSettings?: typeof updateTenantGeneralSettings;
}

export default function SettingsGeneral({
  loadSettings = getTenantGeneralSettings,
  saveSettings = updateTenantGeneralSettings,
}: SettingsGeneralProps = {}): JSX.Element {
  const { t, supportedLocales } = useLanguage();
  const announce = useAnnounce();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<
    | { kind: 'idle' }
    | { kind: 'submitting' }
    | { kind: 'success'; message: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const schema = useMemo(() => buildSchema(t), [t]);

  const form = useForm<SettingsGeneralFormValues>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: {
      brandName: '',
      defaultLanguage: 'en',
      defaultThemeMode: 'system',
      notificationsEmail: '',
      tenantTimezone: 'UTC',
    },
  });
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isDirty, isSubmitting },
  } = form;

  // Watch the radix-Select-bound fields so we can render the controlled
  // values without needing `Controller` wrappers (the radix Select takes
  // value/onValueChange).
  const themeMode = watch('defaultThemeMode');
  const defaultLanguage = watch('defaultLanguage');
  const tenantTimezone = watch('tenantTimezone');

  // Locale and timezone option lists.
  const locales = useMemo(() => {
    const set = new Set<string>([...supportedLocales, ...SUPPORTED_LOCALES]);
    return Array.from(set);
  }, [supportedLocales]);
  const timezones = useMemo(() => getSupportedTimezones(), []);

  // ─── Initial load ───────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    loadSettings()
      .then((settings) => {
        if (cancelled) return;
        reset(settings);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error
            ? err.message
            : t('settings.general.loadFailed'),
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadSettings, reset, t]);

  // ─── Submit handler ─────────────────────────────────────────────────

  async function onSubmit(values: SettingsGeneralFormValues): Promise<void> {
    setSubmitState({ kind: 'submitting' });
    try {
      const patch: TenantGeneralSettingsPatch = { ...values };
      const updated = await saveSettings(patch);
      // Reset the form with the canonical server snapshot so `isDirty`
      // tracks future edits relative to the latest persisted state.
      reset(updated);
      const message = t('settings.general.saveSuccess');
      setSubmitState({ kind: 'success', message });
      announce(message, 'polite');
    } catch (err: unknown) {
      const message =
        err instanceof AdminApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : t('settings.general.saveFailed');
      setSubmitState({ kind: 'error', message });
      announce(message, 'assertive');
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        className="space-y-6 p-6"
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
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>{t('settings.general.loadFailedTitle')}</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">
          {t('settings.general.title')}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {t('settings.general.description')}
        </p>
      </header>

      {submitState.kind === 'error' && (
        <Alert variant="destructive" className="mb-6" data-testid="settings-general-error">
          <AlertTitle>{t('settings.general.saveFailedTitle')}</AlertTitle>
          <AlertDescription>{submitState.message}</AlertDescription>
        </Alert>
      )}
      {submitState.kind === 'success' && (
        <Alert className="mb-6" data-testid="settings-general-success">
          <AlertTitle>{t('settings.general.saveSuccessTitle')}</AlertTitle>
          <AlertDescription>{submitState.message}</AlertDescription>
        </Alert>
      )}

      <form
        noValidate
        onSubmit={(event) => {
          void handleSubmit(onSubmit)(event);
        }}
        className="space-y-6 max-w-2xl"
        aria-busy={isSubmitting || submitState.kind === 'submitting'}
        data-testid="settings-general-form"
      >
        <FormField
          id="settings-general-brandName"
          label={t('settings.general.fields.brandName')}
          description={t('settings.general.hints.brandName')}
          required
          error={errors.brandName?.message ?? null}
        >
          <Input
            id="settings-general-brandName"
            autoComplete="organization"
            maxLength={40}
            data-testid="settings-general-brandName"
            {...register('brandName')}
          />
        </FormField>

        <FormField
          id="settings-general-defaultLanguage"
          label={t('settings.general.fields.defaultLanguage')}
          description={t('settings.general.hints.defaultLanguage')}
          required
          error={errors.defaultLanguage?.message ?? null}
        >
          <Select
            value={defaultLanguage}
            onValueChange={(value) =>
              setValue('defaultLanguage', value, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
          >
            <SelectTrigger
              id="settings-general-defaultLanguage"
              data-testid="settings-general-defaultLanguage"
              aria-label={t('settings.general.fields.defaultLanguage')}
            >
              <SelectValue placeholder={t('settings.general.placeholders.defaultLanguage')} />
            </SelectTrigger>
            <SelectContent>
              {locales.map((code) => (
                <SelectItem key={code} value={code}>
                  {t(`settings.general.locales.${code}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField
          id="settings-general-defaultThemeMode"
          label={t('settings.general.fields.defaultThemeMode')}
          description={t('settings.general.hints.defaultThemeMode')}
          required
          error={errors.defaultThemeMode?.message ?? null}
        >
          <Select
            value={themeMode}
            onValueChange={(value) =>
              setValue(
                'defaultThemeMode',
                value as SettingsGeneralFormValues['defaultThemeMode'],
                { shouldDirty: true, shouldValidate: true },
              )
            }
          >
            <SelectTrigger
              id="settings-general-defaultThemeMode"
              data-testid="settings-general-defaultThemeMode"
              aria-label={t('settings.general.fields.defaultThemeMode')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">
                {t('settings.general.themeMode.light')}
              </SelectItem>
              <SelectItem value="dark">
                {t('settings.general.themeMode.dark')}
              </SelectItem>
              <SelectItem value="system">
                {t('settings.general.themeMode.system')}
              </SelectItem>
            </SelectContent>
          </Select>
        </FormField>

        <FormField
          id="settings-general-notificationsEmail"
          label={t('settings.general.fields.notificationsEmail')}
          description={t('settings.general.hints.notificationsEmail')}
          required
          error={errors.notificationsEmail?.message ?? null}
        >
          <Input
            id="settings-general-notificationsEmail"
            type="email"
            autoComplete="email"
            inputMode="email"
            maxLength={254}
            data-testid="settings-general-notificationsEmail"
            {...register('notificationsEmail')}
          />
        </FormField>

        <FormField
          id="settings-general-tenantTimezone"
          label={t('settings.general.fields.tenantTimezone')}
          description={t('settings.general.hints.tenantTimezone')}
          required
          error={errors.tenantTimezone?.message ?? null}
        >
          <Select
            value={tenantTimezone}
            onValueChange={(value) =>
              setValue('tenantTimezone', value, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
          >
            <SelectTrigger
              id="settings-general-tenantTimezone"
              data-testid="settings-general-tenantTimezone"
              aria-label={t('settings.general.fields.tenantTimezone')}
            >
              <SelectValue placeholder={t('settings.general.placeholders.tenantTimezone')} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {timezones.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <div className="flex items-center gap-3 pt-2">
          <Button
            type="submit"
            disabled={!isDirty || isSubmitting}
            data-testid="settings-general-submit"
            className="min-h-[48px]"
          >
            {isSubmitting
              ? t('settings.general.saving')
              : t('settings.general.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}

// Re-export the form values type for tests that want to assert payload shape.
export type { SettingsGeneralFormValues };
