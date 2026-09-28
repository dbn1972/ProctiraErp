'use client';

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@proctira/ui/components';
import {
  InstitutionDeactivateButton,
  InstitutionReactivateButton,
} from '@/components/institutions/institution-row-actions';
import {
  createInstitutionAction,
  updateInstitutionAction,
  type ActionResult,
  type FieldError,
} from '@/lib/institutions/actions';
import { coordinateMapPreview } from '@/lib/institutions/load-state';
import { institutionFormSchema, type InstitutionFormValues } from '@/lib/institutions/validation';
import type { Institution } from '@/lib/institutions/types';

interface SelectOption {
  id: string;
  name: string;
}

export interface InstitutionFormProps {
  /** Existing institution when editing; omit for create mode. */
  initialValue?: Institution;
  /** Available areas for selection (kept simple for forms; AreaPicker is on list view). */
  areas: SelectOption[];
  types: SelectOption[];
  sectors: SelectOption[];
  ownerships: SelectOption[];
}

const PLACEHOLDER_UUID = '';
const WINDOW_DIRTY_BAG = '__proctiraInstitutionFormDirty';

function readWindowDirty(formKey: string): boolean {
  if (typeof window === 'undefined') return false;
  const bag = (window as unknown as Record<string, Record<string, boolean>>)[WINDOW_DIRTY_BAG];
  return Boolean(bag?.[formKey]);
}

function writeWindowDirty(formKey: string, dirty: boolean): void {
  if (typeof window === 'undefined') return;
  const root = window as unknown as Record<string, Record<string, boolean>>;
  const bag = root[WINDOW_DIRTY_BAG] ?? {};
  if (dirty) bag[formKey] = true;
  else delete bag[formKey];
  root[WINDOW_DIRTY_BAG] = bag;
}

function applyServerFieldErrors<T extends Record<string, unknown>>(
  setError: ReturnType<typeof useForm<T>>['setError'],
  fieldErrors: FieldError[] | undefined,
  schemaKeys: ReadonlyArray<keyof T>,
) {
  if (!fieldErrors) return;
  for (const fieldError of fieldErrors) {
    const matchedKey = schemaKeys.find((key) => key === fieldError.field);
    if (matchedKey) {
      setError(matchedKey as never, { type: 'server', message: fieldError.message });
    }
  }
}

export function InstitutionForm({
  initialValue,
  areas,
  types,
  sectors,
  ownerships,
}: InstitutionFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  // Window bag survives RSC/client remounts that reset React state mid-edit
  // (seen in Playwright production fills where data-dirty snapped back to false).
  const formKey = initialValue?.id ?? 'new';
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(() => readWindowDirty(formKey));

  const form = useForm<InstitutionFormValues>({
    resolver: zodResolver(institutionFormSchema),
    defaultValues: {
      name: initialValue?.name ?? '',
      code: initialValue?.code ?? '',
      areaId: initialValue?.areaId ?? PLACEHOLDER_UUID,
      typeId: initialValue?.typeId ?? PLACEHOLDER_UUID,
      sectorId: initialValue?.sectorId ?? PLACEHOLDER_UUID,
      ownershipId: initialValue?.ownershipId ?? PLACEHOLDER_UUID,
      address: initialValue?.address ?? '',
      contactPhone: initialValue?.contactPhone ?? '',
      contactEmail: initialValue?.contactEmail ?? '',
      latitude: initialValue?.latitude ?? '',
      longitude: initialValue?.longitude ?? '',
    },
  });

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    watch,
    formState: { errors, isDirty },
  } = form;

  const leaveHref = initialValue ? `/institutions/${initialValue.id}/overview` : '/institutions';
  const formRef = useRef<HTMLFormElement | null>(null);
  const formIsDirty = isDirty || hasUnsavedChanges || readWindowDirty(formKey);
  const isDirtyRef = useRef(formIsDirty);
  isDirtyRef.current = formIsDirty;

  const markDirty = () => {
    writeWindowDirty(formKey, true);
    isDirtyRef.current = true;
    formRef.current?.setAttribute('data-dirty', 'true');
    setHasUnsavedChanges(true);
  };
  const markDirtyRef = useRef(markDirty);
  markDirtyRef.current = markDirty;

  const clearDirty = () => {
    writeWindowDirty(formKey, false);
    isDirtyRef.current = false;
    formRef.current?.setAttribute('data-dirty', 'false');
    setHasUnsavedChanges(false);
  };

  useLayoutEffect(() => {
    if (readWindowDirty(formKey)) {
      formRef.current?.setAttribute('data-dirty', 'true');
      setHasUnsavedChanges(true);
    }
    const formEl = formRef.current;
    // Native capture listeners — React synthetic onInput can miss Playwright's
    // dispatched Events in the production Next build used by CI.
    const onNativeEdit = () => {
      markDirtyRef.current();
    };
    formEl?.addEventListener('input', onNativeEdit, true);
    formEl?.addEventListener('change', onNativeEdit, true);
    return () => {
      formEl?.removeEventListener('input', onNativeEdit, true);
      formEl?.removeEventListener('change', onNativeEdit, true);
    };
  }, [formKey]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current && !readWindowDirty(formKey)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const onClick = (event: MouseEvent) => {
      // Re-read window bag — remounts can leave isDirtyRef false while edits remain.
      if (!isDirtyRef.current && !readWindowDirty(formKey)) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a');
      if (!anchor) return;
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      const ok = window.confirm('You have unsaved changes. Leave without saving?');
      if (!ok) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [formKey]);

  const areaId = watch('areaId');
  const typeId = watch('typeId');
  const sectorId = watch('sectorId');
  const ownershipId = watch('ownershipId');
  const latitude = watch('latitude');
  const longitude = watch('longitude');
  const mapHref = coordinateMapPreview(latitude, longitude);

  const selectValue = (field: 'areaId' | 'typeId' | 'sectorId' | 'ownershipId', value: string) => {
    setValue(field, value, { shouldValidate: true, shouldDirty: true });
    markDirty();
  };

  const cancel = () => {
    const dirty = isDirty || hasUnsavedChanges || readWindowDirty(formKey);
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    clearDirty();
    router.push(leaveHref);
  };

  const onSubmit = handleSubmit((values) => {
    setServerError(null);
    startTransition(async () => {
      const result: ActionResult<{ id: string }> = initialValue
        ? await updateInstitutionAction(initialValue.id, values)
        : await createInstitutionAction(values);

      if (result.success) {
        clearDirty();
        router.push(`/institutions/${result.data.id}/overview`);
        router.refresh();
        return;
      }

      setServerError(result.error);
      applyServerFieldErrors(setError, result.fieldErrors, [
        'name',
        'code',
        'areaId',
        'typeId',
        'sectorId',
        'ownershipId',
        'address',
        'contactPhone',
        'contactEmail',
        'latitude',
        'longitude',
      ] as const);
    });
  });

  return (
    <div className="space-y-8" data-dirty={formIsDirty ? 'true' : 'false'}>
      <form
        ref={formRef}
        onSubmit={(event) => {
          void onSubmit(event);
        }}
        className="space-y-8"
        data-testid="institution-profile-form"
        data-dirty={formIsDirty ? 'true' : 'false'}
      >
        {serverError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {serverError}
          </div>
        )}

        <section className="space-y-4" aria-labelledby="institution-identity-heading">
          <h3 id="institution-identity-heading" className="text-sm font-semibold text-foreground">
            Identity
          </h3>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                {...register('name', {
                  onChange: () => {
                    markDirty();
                  },
                })}
                disabled={isPending}
                aria-invalid={errors.name ? 'true' : 'false'}
                aria-describedby={errors.name ? 'name-error' : undefined}
              />
              {errors.name && (
                <p id="name-error" className="text-sm text-destructive">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="code">
                UDISE code <span className="text-destructive">*</span>
              </Label>
              <Input
                id="code"
                {...register('code', {
                  onChange: () => {
                    markDirty();
                  },
                })}
                disabled={isPending}
                placeholder="07040100417"
                aria-invalid={errors.code ? 'true' : 'false'}
                aria-describedby={errors.code ? 'code-error' : 'code-hint'}
              />
              <p id="code-hint" className="text-xs text-muted-foreground">
                The school&apos;s UDISE code. It must be unique in this organisation.
              </p>
              {errors.code && (
                <p id="code-error" className="text-sm text-destructive">
                  {errors.code.message}
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-4" aria-labelledby="institution-classification-heading">
          <h3
            id="institution-classification-heading"
            className="text-sm font-semibold text-foreground"
          >
            Classification
          </h3>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="areaId">
                Area <span className="text-destructive">*</span>
              </Label>
              <Select
                value={areaId || undefined}
                onValueChange={(value) => selectValue('areaId', value)}
                disabled={isPending}
              >
                <SelectTrigger id="areaId" aria-invalid={errors.areaId ? 'true' : 'false'}>
                  <SelectValue placeholder="Select an area" />
                </SelectTrigger>
                <SelectContent>
                  {areas.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.areaId && <p className="text-sm text-destructive">{errors.areaId.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="typeId">
                Type <span className="text-destructive">*</span>
              </Label>
              <Select
                value={typeId || undefined}
                onValueChange={(value) => selectValue('typeId', value)}
                disabled={isPending}
              >
                <SelectTrigger id="typeId" aria-invalid={errors.typeId ? 'true' : 'false'}>
                  <SelectValue placeholder="Select a type" />
                </SelectTrigger>
                <SelectContent>
                  {types.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.typeId && <p className="text-sm text-destructive">{errors.typeId.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="sectorId">
                Sector <span className="text-destructive">*</span>
              </Label>
              <Select
                value={sectorId || undefined}
                onValueChange={(value) => selectValue('sectorId', value)}
                disabled={isPending}
              >
                <SelectTrigger id="sectorId" aria-invalid={errors.sectorId ? 'true' : 'false'}>
                  <SelectValue placeholder="Select a sector" />
                </SelectTrigger>
                <SelectContent>
                  {sectors.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.sectorId && (
                <p className="text-sm text-destructive">{errors.sectorId.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="ownershipId">
                Ownership <span className="text-destructive">*</span>
              </Label>
              <Select
                value={ownershipId || undefined}
                onValueChange={(value) => selectValue('ownershipId', value)}
                disabled={isPending}
              >
                <SelectTrigger
                  id="ownershipId"
                  aria-invalid={errors.ownershipId ? 'true' : 'false'}
                >
                  <SelectValue placeholder="Select an ownership" />
                </SelectTrigger>
                <SelectContent>
                  {ownerships.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.ownershipId && (
                <p className="text-sm text-destructive">{errors.ownershipId.message}</p>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-4" aria-labelledby="institution-location-heading">
          <h3 id="institution-location-heading" className="text-sm font-semibold text-foreground">
            Location and contact
          </h3>
          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Textarea
              id="address"
              {...register('address')}
              disabled={isPending}
              rows={3}
              aria-invalid={errors.address ? 'true' : 'false'}
            />
            {errors.address && <p className="text-sm text-destructive">{errors.address.message}</p>}
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contactPhone">Contact phone</Label>
              <Input
                id="contactPhone"
                type="tel"
                {...register('contactPhone')}
                disabled={isPending}
                aria-invalid={errors.contactPhone ? 'true' : 'false'}
              />
              {errors.contactPhone && (
                <p className="text-sm text-destructive">{errors.contactPhone.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="contactEmail">Contact email</Label>
              <Input
                id="contactEmail"
                type="email"
                {...register('contactEmail')}
                disabled={isPending}
                aria-invalid={errors.contactEmail ? 'true' : 'false'}
              />
              {errors.contactEmail && (
                <p className="text-sm text-destructive">{errors.contactEmail.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="latitude">Latitude</Label>
              <Input
                id="latitude"
                type="number"
                step="any"
                inputMode="decimal"
                placeholder="28.6072"
                {...register('latitude')}
                disabled={isPending}
                aria-invalid={errors.latitude ? 'true' : 'false'}
                aria-describedby="latitude-hint"
              />
              <p id="latitude-hint" className="text-xs text-muted-foreground">
                Decimal degrees, from -90 to 90. Example: 28.6072.
              </p>
              {errors.latitude && (
                <p className="text-sm text-destructive">{errors.latitude.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="longitude">Longitude</Label>
              <Input
                id="longitude"
                type="number"
                step="any"
                inputMode="decimal"
                placeholder="77.2965"
                {...register('longitude')}
                disabled={isPending}
                aria-invalid={errors.longitude ? 'true' : 'false'}
                aria-describedby="longitude-hint"
              />
              <p id="longitude-hint" className="text-xs text-muted-foreground">
                Decimal degrees, from -180 to 180. Example: 77.2965.
              </p>
              {errors.longitude && (
                <p className="text-sm text-destructive">{errors.longitude.message}</p>
              )}
            </div>
          </div>
          {mapHref ? (
            <a
              href={mapHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-sm font-medium text-primary underline underline-offset-4"
              data-testid="coordinate-map-preview"
            >
              Preview on map
            </a>
          ) : (
            <p className="text-xs text-muted-foreground">
              Enter both coordinates to preview the school on a map. The staff app does not embed a
              map picker.
            </p>
          )}
        </section>

        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="outline" onClick={cancel} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {initialValue ? 'Save changes' : 'Create institution'}
          </Button>
        </div>
      </form>
      {initialValue ? (
        <section
          className="space-y-3 rounded-lg border border-border p-4"
          aria-labelledby="institution-status-heading"
        >
          <h3 id="institution-status-heading" className="text-sm font-semibold text-foreground">
            School status
          </h3>
          <p className="text-sm text-muted-foreground">
            {initialValue.status === 'ACTIVE'
              ? 'This school is active. Deactivating it hides operational counts and blocks new enrollments.'
              : 'This school is inactive. Reactivating it allows new enrollments again.'}
            {initialValue.deactivationReason
              ? ` Reason on file: ${initialValue.deactivationReason}`
              : ''}
          </p>
          {initialValue.status === 'ACTIVE' ? (
            <InstitutionDeactivateButton id={initialValue.id} name={initialValue.name} />
          ) : (
            <InstitutionReactivateButton id={initialValue.id} name={initialValue.name} inactive />
          )}
        </section>
      ) : null}
    </div>
  );
}
