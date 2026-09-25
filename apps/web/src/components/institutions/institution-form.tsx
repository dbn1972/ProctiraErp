'use client';

import { useState, useTransition } from 'react';
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
  createInstitutionAction,
  updateInstitutionAction,
  type ActionResult,
  type FieldError,
} from '@/lib/institutions/actions';
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
  /**
   * Set when the area lookup failed. The form then explains the failure rather
   * than rendering an empty or invented picker for a real foreign key.
   */
  areaError?: string | null;
}

const PLACEHOLDER_UUID = '';

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

export function InstitutionForm({ initialValue, areas, areaError = null }: InstitutionFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

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
    formState: { errors },
  } = form;

  // Only `areaId` is a controlled Select; the vocabulary fields are registered
  // text inputs and do not need to be watched.
  const areaId = watch('areaId');

  const onSubmit = handleSubmit((values) => {
    setServerError(null);
    startTransition(async () => {
      const result: ActionResult<{ id: string }> = initialValue
        ? await updateInstitutionAction(initialValue.id, values)
        : await createInstitutionAction(values);

      if (result.success) {
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
    <form
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      className="space-y-6"
    >
      {serverError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {serverError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">
            Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="name"
            {...register('name')}
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
            Code <span className="text-destructive">*</span>
          </Label>
          <Input
            id="code"
            {...register('code')}
            disabled={isPending}
            aria-invalid={errors.code ? 'true' : 'false'}
            aria-describedby={errors.code ? 'code-error' : undefined}
          />
          {errors.code && (
            <p id="code-error" className="text-sm text-destructive">
              {errors.code.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="areaId">
            Area <span className="text-destructive">*</span>
          </Label>
          {areaError ? (
            /*
             * Areas are a real foreign key. If the lookup failed we say so and
             * block submission instead of offering invented options: the create
             * would be rejected by
             * `institutions.area_id REFERENCES geographic_areas(id)`.
             */
            <p id="areaId-error" role="alert" className="text-sm text-destructive">
              {areaError} Areas must load before an institution can be registered.
            </p>
          ) : areas.length === 0 ? (
            <p id="areaId-help" className="text-sm text-muted-foreground">
              No areas exist for this tenant yet. Create an area in the area hierarchy first.
            </p>
          ) : (
            <Select
              value={areaId || undefined}
              onValueChange={(value) => setValue('areaId', value, { shouldValidate: true })}
              disabled={isPending}
            >
              <SelectTrigger
                id="areaId"
                aria-invalid={errors.areaId ? 'true' : 'false'}
                aria-describedby={errors.areaId ? 'areaId-error' : undefined}
              >
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
          )}
          {errors.areaId && !areaError && (
            <p id="areaId-error" className="text-sm text-destructive">
              {errors.areaId.message}
            </p>
          )}
        </div>

        {/*
         * Type / sector / ownership are free text, not pickers.
         *
         * They persist to `institutions.type|sector|ownership VARCHAR(50)` and
         * no reference table for them exists in the Prisma schema, in db/sql or
         * in the database. They were previously Selects fed by three invented
         * UUID lists, so the only values a user could submit were UUIDs written
         * verbatim into a column whose real vocabulary is `K12` / `GOVERNMENT` /
         * `CENTRAL`. Promoting one taxonomy to a controlled list is a product
         * decision; until then, collect the code honestly.
         */}
        <div className="space-y-2">
          <Label htmlFor="typeId">
            Type <span className="text-destructive">*</span>
          </Label>
          <Input
            id="typeId"
            {...register('typeId')}
            disabled={isPending}
            placeholder="K12"
            aria-invalid={errors.typeId ? 'true' : 'false'}
            aria-describedby={errors.typeId ? 'typeId-error' : 'typeId-help'}
          />
          {errors.typeId ? (
            <p id="typeId-error" className="text-sm text-destructive">
              {errors.typeId.message}
            </p>
          ) : (
            <p id="typeId-help" className="text-sm text-muted-foreground">
              Institution type code used by your jurisdiction, for example K12.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="sectorId">
            Sector <span className="text-destructive">*</span>
          </Label>
          <Input
            id="sectorId"
            {...register('sectorId')}
            disabled={isPending}
            placeholder="GOVERNMENT"
            aria-invalid={errors.sectorId ? 'true' : 'false'}
            aria-describedby={errors.sectorId ? 'sectorId-error' : 'sectorId-help'}
          />
          {errors.sectorId ? (
            <p id="sectorId-error" className="text-sm text-destructive">
              {errors.sectorId.message}
            </p>
          ) : (
            <p id="sectorId-help" className="text-sm text-muted-foreground">
              Sector code, for example GOVERNMENT, AIDED or PRIVATE.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="ownershipId">
            Ownership <span className="text-destructive">*</span>
          </Label>
          <Input
            id="ownershipId"
            {...register('ownershipId')}
            disabled={isPending}
            placeholder="CENTRAL"
            aria-invalid={errors.ownershipId ? 'true' : 'false'}
            aria-describedby={errors.ownershipId ? 'ownershipId-error' : 'ownershipId-help'}
          />
          {errors.ownershipId ? (
            <p id="ownershipId-error" className="text-sm text-destructive">
              {errors.ownershipId.message}
            </p>
          ) : (
            <p id="ownershipId-help" className="text-sm text-muted-foreground">
              Ownership code, for example CENTRAL, STATE or PRIVATE.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="address">Address</Label>
        <Textarea
          id="address"
          {...register('address')}
          disabled={isPending}
          rows={3}
          aria-invalid={errors.address ? 'true' : 'false'}
          aria-describedby={errors.address ? 'address-error' : undefined}
        />
        {errors.address && (
          <p id="address-error" className="text-sm text-destructive">
            {errors.address.message}
          </p>
        )}
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
            aria-describedby={errors.contactPhone ? 'contactPhone-error' : undefined}
          />
          {errors.contactPhone && (
            <p id="contactPhone-error" className="text-sm text-destructive">
              {errors.contactPhone.message}
            </p>
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
            aria-describedby={errors.contactEmail ? 'contactEmail-error' : undefined}
          />
          {errors.contactEmail && (
            <p id="contactEmail-error" className="text-sm text-destructive">
              {errors.contactEmail.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="latitude">Latitude</Label>
          <Input
            id="latitude"
            type="number"
            step="any"
            {...register('latitude')}
            disabled={isPending}
            aria-invalid={errors.latitude ? 'true' : 'false'}
            aria-describedby={errors.latitude ? 'latitude-error' : undefined}
          />
          {errors.latitude && (
            <p id="latitude-error" className="text-sm text-destructive">
              {errors.latitude.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="longitude">Longitude</Label>
          <Input
            id="longitude"
            type="number"
            step="any"
            {...register('longitude')}
            disabled={isPending}
            aria-invalid={errors.longitude ? 'true' : 'false'}
            aria-describedby={errors.longitude ? 'longitude-error' : undefined}
          />
          {errors.longitude && (
            <p id="longitude-error" className="text-sm text-destructive">
              {errors.longitude.message}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {initialValue ? 'Save changes' : 'Create institution'}
        </Button>
      </div>
    </form>
  );
}
