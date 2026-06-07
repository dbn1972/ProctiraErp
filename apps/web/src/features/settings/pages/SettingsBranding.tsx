/**
 * SettingsBranding — Settings → Branding (Task 59.2).
 *
 * Form fields per Requirement 42 AC 2 / Requirement 28 AC 7–10 and
 * Design §R.2:
 *
 *   • Tenant logo (`--tenant-logo`)        — SVG/PNG, ≤ 200 × 60 px
 *   • Favicon    (`--tenant-favicon`)      — ICO/PNG, 32 × 32
 *   • Primary brand color (`--tenant-primary`) — ≥ 4.5:1 contrast vs white
 *   • Accent brand color  (`--tenant-accent`)  — ≥ 3:1 contrast vs white
 *   • Login background    (`--tenant-login-bg`) — image URL or CSS gradient
 *
 * Behaviors:
 *
 *   1. **On-the-fly contrast.** As the user types/picks a colour, the
 *      page recomputes the contrast ratio against pure white using the
 *      same math as `tools/scripts/check-contrast.mjs` (Task 56.2) and
 *      `branding-validation.ts` (Task 58.4). The numeric ratio renders
 *      next to the picker; below threshold it turns destructive-red and
 *      blocks Publish.
 *
 *   2. **Live preview.** A right-hand pane mirrors the draft tokens —
 *      header strip, primary button, sign-in panel — so the user sees
 *      the resulting branding before flipping the preview cookie or
 *      publishing.
 *
 *   3. **Preview toggle.** Flips the `Tenant-Theme-Preview` cookie from
 *      Task 58.3 (via `enableBrandingPreview`/`disableBrandingPreview`)
 *      so the active session, if it carries `branding:preview`, sees
 *      draft tokens applied app-wide.
 *
 *   4. **Publish.** Calls `POST /api/v1/tenant/branding/publish` which
 *      runs the server-side guards from Task 58.4. A structured
 *      validation error surfaces inline next to the failing field
 *      (`logoUrl`, `faviconUrl`, `primaryColor`, `accentColor`,
 *      `loginBackground`).
 *
 * Cross-cutting rules applied here mirror SettingsGeneral (Task 59.1):
 *   • Accessibility (Task 56) — labels via `<FormField>`, inline errors
 *     wired through `aria-describedby`, save/error states announced via
 *     `<LiveRegion>` (`useAnnounce()`), 48 × 48 px button targets.
 *   • Theming (Task 47) — design tokens only, no hex literals in copy.
 *   • i18n (Task 48) — every visible string flows through `t()`.
 *
 * Validates: Requirements 42.2, 42.3, 28.7, 28.8, 28.9, 28.10.
 */
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  FormField,
  Input,
  Skeleton,
  Switch,
  useAnnounce,
} from '@proctira/ui/components';
import { FileUpload } from '@proctira/ui/file-upload';

import {
  ACCENT_CONTRAST_THRESHOLD,
  PRIMARY_CONTRAST_THRESHOLD,
  getContrastRatio,
} from '@/lib/branding/contrast';
import {
  AdminApiError,
  getBrandingState,
  mapPublishErrorsToFields,
  publishBranding,
  rollbackBranding,
  saveBrandingDraft,
  type BrandingFieldError,
  type BrandingTokens,
  type TenantBrandingState,
} from '@/lib/branding/api';
import {
  disableBrandingPreview,
  enableBrandingPreview,
  isBrandingPreviewEnabled,
} from '@/lib/branding/previewCookie';
import { useLanguage } from '@/providers/LanguageProvider';

// ─── Types ───────────────────────────────────────────────────────────────

const TOKEN_NAMES = {
  logo: '--tenant-logo',
  favicon: '--tenant-favicon',
  primary: '--tenant-primary',
  accent: '--tenant-accent',
  loginBg: '--tenant-login-bg',
} as const;

interface SettingsBrandingProps {
  /** Override loaders/mutators for tests. */
  loadBranding?: typeof getBrandingState;
  saveDraft?: typeof saveBrandingDraft;
  publish?: typeof publishBranding;
  rollback?: typeof rollbackBranding;
  /** Override the preview cookie helpers — tests inject mocks. */
  previewCookie?: {
    isEnabled: typeof isBrandingPreviewEnabled;
    enable: typeof enableBrandingPreview;
    disable: typeof disableBrandingPreview;
  };
  /**
   * UUID of the editing user. Required for both `saveDraft` and
   * `publish`. Defaults to the canonical "self" placeholder so the
   * gateway can resolve the actual id from the JWT.
   */
  currentUserId?: string;
}

// ─── Validation schema ───────────────────────────────────────────────────

function buildSchema(t: (key: string, params?: Record<string, string | number>) => string) {
  const colorString = z.string().trim().min(1);
  return z.object({
    logoUrl: z.string().trim().min(1, t('settings.branding.errors.logoRequired')),
    faviconUrl: z
      .string()
      .trim()
      .min(1, t('settings.branding.errors.faviconRequired')),
    primaryColor: colorString
      .refine(
        (v) => {
          const ratio = getContrastRatio(v);
          return typeof ratio === 'number' && ratio >= PRIMARY_CONTRAST_THRESHOLD;
        },
        { message: t('settings.branding.errors.primaryContrast') },
      ),
    accentColor: colorString.refine(
      (v) => {
        const ratio = getContrastRatio(v);
        return typeof ratio === 'number' && ratio >= ACCENT_CONTRAST_THRESHOLD;
      },
      { message: t('settings.branding.errors.accentContrast') },
    ),
    loginBackground: z
      .string()
      .trim()
      .min(1, t('settings.branding.errors.loginBgRequired')),
  });
}

type SettingsBrandingFormValues = z.infer<ReturnType<typeof buildSchema>>;

// ─── Defaults / helpers ──────────────────────────────────────────────────

const DEFAULT_FORM_VALUES: SettingsBrandingFormValues = {
  logoUrl: '/logo.svg',
  faviconUrl: '/favicon.ico',
  primaryColor: 'hsl(222, 47%, 31%)',
  accentColor: 'hsl(174, 62%, 40%)',
  loginBackground:
    'linear-gradient(135deg, hsl(222, 47%, 22%), hsl(222, 47%, 40%))',
};

/**
 * Convert a draft/published tokens record into the form's flat shape.
 * Strips the `url(...)` wrapper applied by the SSR helper and the publish
 * guard so the user sees the bare URL in the form.
 */
function tokensToFormValues(
  tokens: BrandingTokens | null | undefined,
): SettingsBrandingFormValues {
  const out: SettingsBrandingFormValues = { ...DEFAULT_FORM_VALUES };
  if (!tokens) return out;

  const pickString = (key: string): string | null => {
    const v = (tokens as Record<string, unknown>)[key];
    return typeof v === 'string' ? v : null;
  };

  out.logoUrl = unwrapCssUrl(pickString(TOKEN_NAMES.logo)) ?? out.logoUrl;
  out.faviconUrl = unwrapCssUrl(pickString(TOKEN_NAMES.favicon)) ?? out.faviconUrl;
  out.primaryColor = pickString(TOKEN_NAMES.primary) ?? out.primaryColor;
  out.accentColor = pickString(TOKEN_NAMES.accent) ?? out.accentColor;
  out.loginBackground = pickString(TOKEN_NAMES.loginBg) ?? out.loginBackground;
  return out;
}

/**
 * Reverse of `tokensToFormValues`. Wraps logo/favicon URLs in `url(...)`
 * so the resulting tokens map matches the contract the publish guard
 * expects (Design §N).
 */
function formValuesToTokens(values: SettingsBrandingFormValues): BrandingTokens {
  return {
    [TOKEN_NAMES.logo]: `url("${values.logoUrl.trim()}")`,
    [TOKEN_NAMES.favicon]: `url("${values.faviconUrl.trim()}")`,
    [TOKEN_NAMES.primary]: values.primaryColor.trim(),
    [TOKEN_NAMES.accent]: values.accentColor.trim(),
    [TOKEN_NAMES.loginBg]: values.loginBackground.trim(),
  };
}

function unwrapCssUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = /^url\(\s*(['"]?)([^)'"]*)\1\s*\)$/.exec(trimmed);
  return match ? (match[2] ?? '') : trimmed;
}

/**
 * Read a small image file and resolve to a `data:` URI so we can preview
 * it in the form and (for development tenants without an upload service)
 * publish it directly. Production deployments swap in a presigned-URL
 * upload step; the form contract — `logoUrl` / `faviconUrl` are URL
 * strings — does not change.
 */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('Failed to read file'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// ─── Component ───────────────────────────────────────────────────────────

export default function SettingsBranding({
  loadBranding = getBrandingState,
  saveDraft = saveBrandingDraft,
  publish = publishBranding,
  rollback = rollbackBranding,
  previewCookie,
  currentUserId = '00000000-0000-4000-8000-000000000000',
}: SettingsBrandingProps = {}): JSX.Element {
  const { t } = useLanguage();
  const announce = useAnnounce();

  const previewHelpers = useMemo(
    () =>
      previewCookie ?? {
        isEnabled: isBrandingPreviewEnabled,
        enable: enableBrandingPreview,
        disable: disableBrandingPreview,
      },
    [previewCookie],
  );

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverState, setServerState] = useState<TenantBrandingState | null>(null);
  const [previewActive, setPreviewActive] = useState(false);
  const [saveState, setSaveState] = useState<
    | { kind: 'idle' }
    | { kind: 'saving' }
    | { kind: 'success'; message: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const schema = useMemo(() => buildSchema(t), [t]);
  const form = useForm<SettingsBrandingFormValues>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: DEFAULT_FORM_VALUES,
  });
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    setError,
    clearErrors,
    watch,
    formState: { errors, isDirty, isSubmitting },
  } = form;

  // Reactive snapshot used by the contrast read-out and the live preview.
  const draftValues = watch();
  const primaryRatio = useMemo(
    () => getContrastRatio(draftValues.primaryColor ?? ''),
    [draftValues.primaryColor],
  );
  const accentRatio = useMemo(
    () => getContrastRatio(draftValues.accentColor ?? ''),
    [draftValues.accentColor],
  );

  // ─── Initial load ───────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    loadBranding()
      .then((state) => {
        if (cancelled) return;
        setServerState(state);
        const initialTokens = state.draft?.tokens ?? state.published?.tokens ?? null;
        reset(tokensToFormValues(initialTokens));
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error ? err.message : t('settings.branding.loadFailed'),
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadBranding, reset, t]);

  // Sync the preview-toggle's UI state with the cookie on mount.
  useEffect(() => {
    setPreviewActive(previewHelpers.isEnabled());
  }, [previewHelpers]);

  // ─── Handlers ───────────────────────────────────────────────────────

  const handleLogoFile = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      try {
        const dataUrl = await readFileAsDataUrl(file);
        setValue('logoUrl', dataUrl, {
          shouldDirty: true,
          shouldValidate: true,
        });
      } catch {
        setError('logoUrl', {
          type: 'manual',
          message: t('settings.branding.errors.logoReadFailed'),
        });
      }
    },
    [setValue, setError, t],
  );

  const handleFaviconFile = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      try {
        const dataUrl = await readFileAsDataUrl(file);
        setValue('faviconUrl', dataUrl, {
          shouldDirty: true,
          shouldValidate: true,
        });
      } catch {
        setError('faviconUrl', {
          type: 'manual',
          message: t('settings.branding.errors.faviconReadFailed'),
        });
      }
    },
    [setValue, setError, t],
  );

  const handlePreviewToggle = useCallback(
    (next: boolean) => {
      if (next) {
        previewHelpers.enable();
      } else {
        previewHelpers.disable();
      }
      setPreviewActive(next);
      announce(
        t(
          next
            ? 'settings.branding.previewEnabled'
            : 'settings.branding.previewDisabled',
        ),
        'polite',
      );
    },
    [previewHelpers, announce, t],
  );

  /**
   * Save the current form values as a draft (persisted, no version
   * history) so a Preview-mode reload still shows the in-progress
   * tokens.
   */
  const onSaveDraft = useCallback(
    async (values: SettingsBrandingFormValues): Promise<void> => {
      setSaveState({ kind: 'saving' });
      clearErrors();
      try {
        const draft = await saveDraft({
          tokens: formValuesToTokens(values),
          savedBy: currentUserId,
        });
        setServerState((prev) => ({ ...(prev ?? { draft: null, published: null }), draft }));
        const message = t('settings.branding.draftSaved');
        setSaveState({ kind: 'success', message });
        announce(message, 'polite');
        // Keep the form's "dirty" baseline aligned with the saved draft.
        reset(tokensToFormValues(draft.tokens));
      } catch (err: unknown) {
        const message =
          err instanceof AdminApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : t('settings.branding.draftSaveFailed');
        setSaveState({ kind: 'error', message });
        announce(message, 'assertive');
      }
    },
    [saveDraft, currentUserId, reset, t, announce, clearErrors],
  );

  /**
   * Publish the current form values as a new revision. Server-side
   * guards (Task 58.4) re-validate logo dimensions, favicon size, and
   * colour contrasts; structured field errors are mapped back onto the
   * matching form fields.
   */
  const onPublish = useCallback(
    async (values: SettingsBrandingFormValues): Promise<void> => {
      setSaveState({ kind: 'saving' });
      clearErrors();
      try {
        const published = await publish({
          tokens: formValuesToTokens(values),
          publishedBy: currentUserId,
        });
        setServerState((prev) => ({
          draft: prev?.draft ?? null,
          published,
        }));
        const message = t('settings.branding.publishSuccess');
        setSaveState({ kind: 'success', message });
        announce(message, 'polite');
        reset(tokensToFormValues(published.tokens));
      } catch (err: unknown) {
        if (err instanceof AdminApiError && Array.isArray(
          (err.details as { errors?: BrandingFieldError[] } | null)?.errors,
        )) {
          const fieldErrors = mapPublishErrorsToFields(
            (err.details as { errors: BrandingFieldError[] }).errors,
          );
          for (const [field, message] of Object.entries(fieldErrors)) {
            setError(field as keyof SettingsBrandingFormValues, {
              type: 'server',
              message,
            });
          }
          const message =
            err.message ?? t('settings.branding.publishValidationFailed');
          setSaveState({ kind: 'error', message });
          announce(message, 'assertive');
          return;
        }
        const message =
          err instanceof AdminApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : t('settings.branding.publishFailed');
        setSaveState({ kind: 'error', message });
        announce(message, 'assertive');
      }
    },
    [publish, currentUserId, reset, t, announce, clearErrors, setError],
  );

  /**
   * Rollback to a previously published revision. Reactivates the
   * specified version's tokens as the current published branding.
   */
  const onRollback = useCallback(
    async (version: number): Promise<void> => {
      setSaveState({ kind: 'saving' });
      clearErrors();
      try {
        const published = await rollback({ version });
        setServerState((prev) => ({
          draft: prev?.draft ?? null,
          published,
        }));
        const message = t('settings.branding.rollbackSuccess');
        setSaveState({ kind: 'success', message });
        announce(message, 'polite');
        reset(tokensToFormValues(published.tokens));
      } catch (err: unknown) {
        const message =
          err instanceof AdminApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : t('settings.branding.rollbackFailed');
        setSaveState({ kind: 'error', message });
        announce(message, 'assertive');
      }
    },
    [rollback, reset, t, announce, clearErrors],
  );

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
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>{t('settings.branding.loadFailedTitle')}</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const publishedRevision = serverState?.published?.revision ?? null;

  return (
    <div className="p-6" data-testid="settings-branding-page">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {t('settings.branding.title')}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {t('settings.branding.description')}
          </p>
          {publishedRevision !== null && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('settings.branding.currentRevision', {
                revision: publishedRevision,
              })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label
            htmlFor="settings-branding-preview-toggle"
            className="text-sm font-medium text-foreground"
          >
            {t('settings.branding.previewToggle')}
          </label>
          <Switch
            id="settings-branding-preview-toggle"
            data-testid="settings-branding-preview-toggle"
            checked={previewActive}
            onCheckedChange={handlePreviewToggle}
            aria-label={t('settings.branding.previewToggle')}
          />
        </div>
      </header>

      {saveState.kind === 'error' && (
        <Alert
          variant="destructive"
          className="mb-6"
          data-testid="settings-branding-error"
        >
          <AlertTitle>{t('settings.branding.errorTitle')}</AlertTitle>
          <AlertDescription>{saveState.message}</AlertDescription>
        </Alert>
      )}
      {saveState.kind === 'success' && (
        <Alert className="mb-6" data-testid="settings-branding-success">
          <AlertTitle>{t('settings.branding.successTitle')}</AlertTitle>
          <AlertDescription>{saveState.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* ─── Form column ─────────────────────────────────────── */}
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit(onPublish)(event);
          }}
          aria-busy={isSubmitting || saveState.kind === 'saving'}
          className="space-y-6 lg:col-span-7"
          data-testid="settings-branding-form"
        >
          <Card>
            <CardContent className="space-y-6 p-6">
              <h2 className="text-lg font-semibold text-foreground">
                {t('settings.branding.sections.identity')}
              </h2>

              <FormField
                id="settings-branding-logoUrl"
                label={t('settings.branding.fields.logo')}
                description={t('settings.branding.hints.logo')}
                required
                error={errors.logoUrl?.message ?? null}
              >
                <div className="space-y-3">
                  <Input
                    id="settings-branding-logoUrl"
                    data-testid="settings-branding-logoUrl"
                    autoComplete="off"
                    placeholder={t('settings.branding.placeholders.logo')}
                    {...register('logoUrl')}
                  />
                  <FileUpload
                    accept={['image/svg+xml', 'image/png']}
                    maxSize={200 * 1024}
                    maxFiles={1}
                    onFilesSelected={(files) => void handleLogoFile(files)}
                    ariaLabel={t('settings.branding.fields.logo')}
                    dropZoneLabel={t('settings.branding.placeholders.logoUpload')}
                  />
                </div>
              </FormField>

              <FormField
                id="settings-branding-faviconUrl"
                label={t('settings.branding.fields.favicon')}
                description={t('settings.branding.hints.favicon')}
                required
                error={errors.faviconUrl?.message ?? null}
              >
                <div className="space-y-3">
                  <Input
                    id="settings-branding-faviconUrl"
                    data-testid="settings-branding-faviconUrl"
                    autoComplete="off"
                    placeholder={t('settings.branding.placeholders.favicon')}
                    {...register('faviconUrl')}
                  />
                  <FileUpload
                    accept={['image/x-icon', 'image/vnd.microsoft.icon', 'image/png']}
                    maxSize={50 * 1024}
                    maxFiles={1}
                    onFilesSelected={(files) => void handleFaviconFile(files)}
                    ariaLabel={t('settings.branding.fields.favicon')}
                    dropZoneLabel={t('settings.branding.placeholders.faviconUpload')}
                  />
                </div>
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-6 p-6">
              <h2 className="text-lg font-semibold text-foreground">
                {t('settings.branding.sections.colors')}
              </h2>

              <ColorField
                id="settings-branding-primaryColor"
                testId="settings-branding-primaryColor"
                ratioTestId="settings-branding-primaryRatio"
                label={t('settings.branding.fields.primary')}
                description={t('settings.branding.hints.primary')}
                error={errors.primaryColor?.message ?? null}
                value={draftValues.primaryColor ?? ''}
                onChange={(next) =>
                  setValue('primaryColor', next, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
                ratio={primaryRatio}
                threshold={PRIMARY_CONTRAST_THRESHOLD}
                ratioLabel={t('settings.branding.contrastLabel', {
                  ratio: primaryRatio !== null ? primaryRatio.toFixed(2) : '—',
                  threshold: PRIMARY_CONTRAST_THRESHOLD.toFixed(1),
                })}
              />

              <ColorField
                id="settings-branding-accentColor"
                testId="settings-branding-accentColor"
                ratioTestId="settings-branding-accentRatio"
                label={t('settings.branding.fields.accent')}
                description={t('settings.branding.hints.accent')}
                error={errors.accentColor?.message ?? null}
                value={draftValues.accentColor ?? ''}
                onChange={(next) =>
                  setValue('accentColor', next, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
                ratio={accentRatio}
                threshold={ACCENT_CONTRAST_THRESHOLD}
                ratioLabel={t('settings.branding.contrastLabel', {
                  ratio: accentRatio !== null ? accentRatio.toFixed(2) : '—',
                  threshold: ACCENT_CONTRAST_THRESHOLD.toFixed(1),
                })}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-6 p-6">
              <h2 className="text-lg font-semibold text-foreground">
                {t('settings.branding.sections.loginBackground')}
              </h2>

              <FormField
                id="settings-branding-loginBackground"
                label={t('settings.branding.fields.loginBg')}
                description={t('settings.branding.hints.loginBg')}
                required
                error={errors.loginBackground?.message ?? null}
              >
                <Input
                  id="settings-branding-loginBackground"
                  data-testid="settings-branding-loginBackground"
                  autoComplete="off"
                  placeholder={t('settings.branding.placeholders.loginBg')}
                  {...register('loginBackground')}
                />
              </FormField>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              data-testid="settings-branding-save-draft"
              className="min-h-[48px]"
              disabled={!isDirty || isSubmitting || saveState.kind === 'saving'}
              onClick={() => {
                void handleSubmit(onSaveDraft)();
              }}
            >
              {t('settings.branding.saveDraft')}
            </Button>
            <Button
              type="submit"
              data-testid="settings-branding-publish"
              className="min-h-[48px]"
              disabled={isSubmitting || saveState.kind === 'saving'}
            >
              {saveState.kind === 'saving'
                ? t('settings.branding.publishing')
                : t('settings.branding.publish')}
            </Button>
            {publishedRevision !== null && publishedRevision > 1 && (
              <Button
                type="button"
                variant="outline"
                data-testid="settings-branding-rollback"
                className="min-h-[48px]"
                disabled={isSubmitting || saveState.kind === 'saving'}
                onClick={() => {
                  void onRollback(publishedRevision - 1);
                }}
              >
                {t('settings.branding.rollback')}
              </Button>
            )}
          </div>
        </form>

        {/* ─── Live preview column ─────────────────────────────── */}
        <aside
          className="lg:col-span-5"
          aria-label={t('settings.branding.preview.label')}
        >
          <Card className="lg:sticky lg:top-6">
            <CardContent className="space-y-4 p-6">
              <h2 className="text-lg font-semibold text-foreground">
                {t('settings.branding.preview.title')}
              </h2>
              <BrandingPreview
                values={draftValues}
                signInLabel={t('settings.branding.preview.signIn')}
                appLabel={t('settings.branding.preview.appLabel')}
              />
              <p className="text-xs italic text-muted-foreground">
                {t('settings.branding.preview.hint')}
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

interface ColorFieldProps {
  id: string;
  testId: string;
  ratioTestId: string;
  label: string;
  description: string;
  error: string | null;
  value: string;
  onChange: (next: string) => void;
  ratio: number | null;
  threshold: number;
  ratioLabel: string;
}

function ColorField({
  id,
  testId,
  ratioTestId,
  label,
  description,
  error,
  value,
  onChange,
  ratio,
  threshold,
  ratioLabel,
}: ColorFieldProps): JSX.Element {
  const accessible = typeof ratio === 'number' && ratio >= threshold;
  return (
    <FormField id={id} label={label} description={description} required error={error}>
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-block h-10 w-10 shrink-0 rounded border border-border"
            style={{ backgroundColor: value }}
            data-testid={`${testId}-swatch`}
          />
          <Input
            id={id}
            data-testid={testId}
            autoComplete="off"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="font-mono"
          />
        </div>
        <p
          data-testid={ratioTestId}
          aria-live="polite"
          className={
            accessible
              ? 'text-xs text-muted-foreground'
              : 'text-xs font-medium text-[hsl(var(--destructive))]'
          }
        >
          {ratioLabel}
        </p>
      </div>
    </FormField>
  );
}

interface BrandingPreviewProps {
  values: SettingsBrandingFormValues;
  signInLabel: string;
  appLabel: string;
}

function BrandingPreview({
  values,
  signInLabel,
  appLabel,
}: BrandingPreviewProps): JSX.Element {
  return (
    <div
      data-testid="settings-branding-preview"
      className="overflow-hidden rounded-lg border border-border"
    >
      {/* Header strip */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ backgroundColor: values.primaryColor }}
      >
        <div className="flex items-center gap-2">
          {values.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={values.logoUrl}
              alt=""
              aria-hidden="true"
              className="h-6 w-auto max-w-[120px] bg-white/10 rounded"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
          ) : null}
          <span className="text-sm font-semibold text-white">{appLabel}</span>
        </div>
        <span
          aria-hidden="true"
          className="inline-block h-6 w-6 rounded-full border-2 border-white/40"
          style={{ backgroundColor: values.accentColor }}
        />
      </div>

      {/* Login surface preview */}
      <div
        className="flex h-40 items-center justify-center px-6"
        style={{ background: values.loginBackground }}
      >
        <button
          type="button"
          className="rounded px-4 py-2 text-sm font-medium text-white shadow"
          style={{ backgroundColor: values.primaryColor }}
          tabIndex={-1}
          aria-hidden="true"
        >
          {signInLabel}
        </button>
      </div>
    </div>
  );
}

// Re-export the form values type for tests asserting payload shape.
export type { SettingsBrandingFormValues };
