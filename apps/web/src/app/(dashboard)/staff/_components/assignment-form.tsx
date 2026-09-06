'use client';

/**
 * Staff assignment form (Client Component).
 *
 * Captures institution, class, subject, role, allocation %, and dates.
 * Submits via the `createAssignmentAction` Server Action.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import {
  Button,
  FormField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@proctira/ui/components';
import {
  assignmentFormSchema,
  type AssignmentFormValues,
} from '@/lib/validation/staff-schema';

import { createAssignmentAction, type ActionState } from '../actions';

interface InstitutionOption {
  id: string;
  name: string;
}

interface SubjectOption {
  id: string;
  name: string;
  code?: string;
}

interface ClassOption {
  id: string;
  name: string;
}

interface AssignmentFormProps {
  staffId: string;
  institutions: InstitutionOption[];
  /** Subject catalog for the picker (replaces raw UUID entry). */
  subjects?: SubjectOption[];
  /** Classes for the selected institution (reloaded via the URL). */
  classes?: ClassOption[];
  defaultInstitutionId?: string;
}

const ZERO_UUID = '00000000-0000-4000-8000-000000000000';

export function AssignmentForm({
  staffId,
  institutions,
  subjects = [],
  classes = [],
  defaultInstitutionId = '',
}: AssignmentFormProps) {
  const router = useRouter();
  const [serverState, setServerState] =
    useState<ActionState<{ assignmentId: string }> | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const form = useForm<AssignmentFormValues>({
    resolver: zodResolver(assignmentFormSchema),
    defaultValues: {
      institutionId: defaultInstitutionId,
      subjectId: '',
      classId: '',
      role: '',
      allocationPercentage: 100,
      startDate: new Date().toISOString().slice(0, 10),
      endDate: '',
    },
    mode: 'onBlur',
  });
  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    setError,
    watch,
  } = form;

  async function onSubmit(values: AssignmentFormValues) {
    setIsPending(true);
    setServerState(null);
    try {
      const result = await createAssignmentAction(staffId, values);
      setServerState(result);
      if (result.status === 'error' && result.fieldErrors) {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          setError(field as keyof AssignmentFormValues, {
            type: 'server',
            message,
          });
        }
      }
      if (result.status === 'success') {
        router.push(`/staff/${staffId}?tab=assignments`);
        router.refresh();
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form
      data-testid="staff-assignment-form"
      data-hydrated={hydrated ? 'true' : 'false'}
      noValidate
      onSubmit={(event) => {
        void handleSubmit(onSubmit)(event);
      }}
      className="space-y-5"
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

      <FormField
        id="institutionId"
        label="Institution"
        required
        error={errors.institutionId?.message ?? null}
      >
        <Select
          value={watch('institutionId') || undefined}
          onValueChange={(value) => {
            setValue('institutionId', value, { shouldValidate: true });
            // Class options depend on the institution — clear the stale
            // selection and reload the page data for the new one.
            setValue('classId', '');
            router.replace(`?institutionId=${encodeURIComponent(value)}`, {
              scroll: false,
            });
          }}
        >
          <SelectTrigger id="institutionId">
            <SelectValue placeholder="Select institution" />
          </SelectTrigger>
          <SelectContent>
            {institutions.length === 0 ? (
              <SelectItem value={ZERO_UUID} disabled>
                No institutions available
              </SelectItem>
            ) : (
              institutions.map((inst) => (
                <SelectItem key={inst.id} value={inst.id}>
                  {inst.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </FormField>

      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          id="classId"
          label="Class"
          required
          error={errors.classId?.message ?? null}
        >
          <Select
            value={watch('classId') || undefined}
            onValueChange={(value) =>
              setValue('classId', value, { shouldValidate: true })
            }
          >
            <SelectTrigger id="classId" aria-label="Class">
              <SelectValue
                placeholder={
                  watch('institutionId')
                    ? 'Select class'
                    : 'Select institution first'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {classes.length === 0 ? (
                <SelectItem value={ZERO_UUID} disabled>
                  {watch('institutionId')
                    ? 'No classes for this institution'
                    : 'Select an institution first'}
                </SelectItem>
              ) : (
                classes.map((cls) => (
                  <SelectItem key={cls.id} value={cls.id}>
                    {cls.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </FormField>

        <FormField
          id="subjectId"
          label="Subject"
          required
          error={errors.subjectId?.message ?? null}
        >
          <Select
            value={watch('subjectId') || undefined}
            onValueChange={(value) =>
              setValue('subjectId', value, { shouldValidate: true })
            }
          >
            <SelectTrigger id="subjectId" aria-label="Subject">
              <SelectValue placeholder="Select subject" />
            </SelectTrigger>
            <SelectContent>
              {subjects.length === 0 ? (
                <SelectItem value={ZERO_UUID} disabled>
                  No subjects available
                </SelectItem>
              ) : (
                subjects.map((subject) => (
                  <SelectItem key={subject.id} value={subject.id}>
                    {subject.name}
                    {subject.code ? ` (${subject.code})` : ''}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </FormField>

        <FormField
          id="role"
          label="Role"
          required
          error={errors.role?.message ?? null}
        >
          <Input id="role" placeholder="Teacher, Assistant…" {...register('role')} />
        </FormField>

        <FormField
          id="allocationPercentage"
          label="Allocation %"
          required
          hint="1–100. Total across active assignments must stay ≤ 100%."
          error={errors.allocationPercentage?.message ?? null}
        >
          <Input
            id="allocationPercentage"
            type="number"
            min={1}
            max={100}
            {...register('allocationPercentage', { valueAsNumber: true })}
          />
        </FormField>

        <FormField
          id="startDate"
          label="Start date"
          required
          error={errors.startDate?.message ?? null}
        >
          <Input id="startDate" type="date" {...register('startDate')} />
        </FormField>

        <FormField
          id="endDate"
          label="End date (optional)"
          error={errors.endDate?.message ?? null}
        >
          <Input id="endDate" type="date" {...register('endDate')} />
        </FormField>
      </div>

      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Creating…' : 'Create assignment'}
        </Button>
      </div>
    </form>
  );
}
