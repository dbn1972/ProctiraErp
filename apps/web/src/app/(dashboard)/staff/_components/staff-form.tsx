'use client';

/**
 * Reusable Staff create / edit form (Client Component).
 *
 * Validation via react-hook-form + zod (mirrors backend Typebox schema).
 * Submits via the matching Server Action (create or update).
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
} from '@proctira/ui/components';
import { staffFormSchema, type StaffFormValues } from '@/lib/validation/staff-schema';

import { createStaffAction, updateStaffAction, type ActionState } from '../actions';

interface StaffFormProps {
  mode: 'create' | 'edit';
  staffId?: string;
  initialValues: StaffFormValues;
}

export function StaffForm({ mode, staffId, initialValues }: StaffFormProps) {
  const router = useRouter();
  const [serverState, setServerState] = useState<ActionState<{ staffId: string }> | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const form = useForm<StaffFormValues>({
    resolver: zodResolver(staffFormSchema),
    defaultValues: initialValues,
    mode: 'onBlur',
  });
  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = form;

  async function onSubmit(values: StaffFormValues) {
    setIsPending(true);
    setServerState(null);
    try {
      const result =
        mode === 'create'
          ? await createStaffAction(values)
          : await updateStaffAction(staffId ?? '', values);
      setServerState(result);
      if (result.status === 'error' && result.fieldErrors) {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          setError(field as keyof StaffFormValues, { type: 'server', message });
        }
      }
      if (result.status === 'success' && result.data?.staffId) {
        router.push(`/staff/${result.data.staffId}`);
        router.refresh();
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form
      data-hydrated={hydrated ? 'true' : 'false'}
      data-testid="staff-form"
      noValidate
      onSubmit={(event) => {
        void handleSubmit(onSubmit)(event);
      }}
      className="space-y-6"
      aria-busy={isPending}
    >
      {serverState?.status === 'error' && serverState.message && (
        <div
          className="rounded-md border border-[hsl(var(--destructive))]/40 bg-[hsl(var(--destructive))]/10 px-4 py-3 text-sm text-[hsl(var(--destructive))]"
          role="alert"
        >
          {serverState.message}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Personal information</CardTitle>
          <CardDescription>All fields are required (Requirement 7.7).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              id="firstName"
              label="First name"
              required
              error={errors.firstName?.message ?? null}
            >
              <Input id="firstName" autoComplete="given-name" {...register('firstName')} />
            </FormField>

            <FormField
              id="lastName"
              label="Last name"
              required
              error={errors.lastName?.message ?? null}
            >
              <Input id="lastName" autoComplete="family-name" {...register('lastName')} />
            </FormField>

            <FormField
              id="dateOfBirth"
              label="Date of birth"
              required
              hint="YYYY-MM-DD"
              error={errors.dateOfBirth?.message ?? null}
            >
              <Input
                id="dateOfBirth"
                type="date"
                autoComplete="bday"
                {...register('dateOfBirth')}
              />
            </FormField>

            <FormField
              id="identityNumber"
              label="Identity number"
              required
              hint="Unique national ID or staff number."
              error={errors.identityNumber?.message ?? null}
            >
              <Input id="identityNumber" {...register('identityNumber')} />
            </FormField>

            <FormField
              id="contactPhone"
              label="Phone"
              required
              error={errors.contactPhone?.message ?? null}
            >
              <Input id="contactPhone" type="tel" {...register('contactPhone')} />
            </FormField>

            <FormField id="contactEmail" label="Email" error={errors.contactEmail?.message ?? null}>
              <Input id="contactEmail" type="email" {...register('contactEmail')} />
            </FormField>

            <FormField
              id="position"
              label="Position"
              required
              error={errors.position?.message ?? null}
              className="md:col-span-2"
            >
              <Input id="position" {...register('position')} placeholder="Teacher, Principal, …" />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending
            ? mode === 'create'
              ? 'Creating…'
              : 'Saving…'
            : mode === 'create'
              ? 'Create staff record'
              : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
