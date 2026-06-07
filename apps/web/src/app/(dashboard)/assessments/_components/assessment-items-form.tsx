'use client';

/**
 * Assessment Items configuration form (Client Component).
 *
 * - Subject UUID + academic period UUID + grading scheme picker.
 * - Up to 50 rows; weights must sum to exactly 100% (validated by zod).
 * - Live total weight indicator with delta from 100%.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';

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
  assessmentItemsFormSchema,
  type AssessmentItemsFormValues,
} from '@/lib/validation/assessment-schema';

import {
  defineAssessmentItemsAction,
  type ActionState,
} from '../actions';

interface SchemeOption {
  id: string;
  name: string;
  type: string;
}

interface ItemDraft {
  name: string;
  weight: number;
  minScore: number;
  maxScore: number;
}

interface SubjectOption {
  id: string;
  name: string;
  code?: string;
}

interface AcademicPeriodOption {
  id: string;
  name: string;
}

interface AssessmentItemsFormProps {
  schemes: SchemeOption[];
  /** Subject catalog for the picker (replaces raw UUID entry). */
  subjects?: SubjectOption[];
  /** Academic periods for the picker. */
  academicPeriods?: AcademicPeriodOption[];
  defaultSubjectId?: string;
  defaultAcademicPeriodId?: string;
  defaultSchemeId?: string;
  defaultItems?: ItemDraft[];
}

const ZERO_UUID = '00000000-0000-4000-8000-000000000000';

export function AssessmentItemsForm({
  schemes,
  subjects = [],
  academicPeriods = [],
  defaultSubjectId = '',
  defaultAcademicPeriodId = '',
  defaultSchemeId = '',
  defaultItems = [],
}: AssessmentItemsFormProps) {
  const [serverState, setServerState] =
    useState<ActionState<{ totalWeight: number }> | null>(null);
  const [isPending, setIsPending] = useState(false);

  const form = useForm<AssessmentItemsFormValues>({
    resolver: zodResolver(assessmentItemsFormSchema),
    defaultValues: {
      subjectId: defaultSubjectId,
      academicPeriodId: defaultAcademicPeriodId,
      gradingSchemeId: defaultSchemeId || schemes[0]?.id || '',
      items:
        defaultItems.length > 0
          ? defaultItems
          : [{ name: '', weight: 100, minScore: 0, maxScore: 100 }],
    },
    mode: 'onBlur',
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    setError,
    control,
    watch,
  } = form;

  const items = useFieldArray({ control, name: 'items' });
  const watchedItems = watch('items');
  const watchedScheme = watch('gradingSchemeId');
  const watchedSubject = watch('subjectId');
  const watchedPeriod = watch('academicPeriodId');

  const totalWeight = watchedItems.reduce(
    (sum, item) => sum + (Number(item?.weight) || 0),
    0,
  );
  const weightDelta = totalWeight - 100;
  const weightOk = Math.abs(weightDelta) <= 0.01;

  async function onSubmit(values: AssessmentItemsFormValues) {
    setIsPending(true);
    setServerState(null);
    try {
      const result = await defineAssessmentItemsAction(values);
      setServerState(result);
      if (result.status === 'error' && result.fieldErrors) {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          setError(field as keyof AssessmentItemsFormValues, {
            type: 'server',
            message,
          });
        }
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form
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

      {serverState?.status === 'success' && serverState.message && (
        <div
          className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700"
          role="status"
        >
          {serverState.message}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <FormField
          id="subjectId"
          label="Subject"
          required
          error={errors.subjectId?.message ?? null}
        >
          <Select
            value={watchedSubject || undefined}
            onValueChange={(value) =>
              setValue('subjectId', value, { shouldValidate: true })
            }
          >
            <SelectTrigger id="subjectId" aria-label="Subject">
              <SelectValue placeholder="Select subject" />
            </SelectTrigger>
            <SelectContent>
              {watchedSubject &&
                !subjects.some((s) => s.id === watchedSubject) && (
                  <SelectItem value={watchedSubject}>
                    Selected subject
                  </SelectItem>
                )}
              {subjects.length === 0 && !watchedSubject ? (
                <SelectItem value={ZERO_UUID} disabled>
                  No subjects
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
          id="academicPeriodId"
          label="Academic period"
          required
          error={errors.academicPeriodId?.message ?? null}
        >
          <Select
            value={watchedPeriod || undefined}
            onValueChange={(value) =>
              setValue('academicPeriodId', value, { shouldValidate: true })
            }
          >
            <SelectTrigger id="academicPeriodId" aria-label="Academic period">
              <SelectValue placeholder="Select period" />
            </SelectTrigger>
            <SelectContent>
              {watchedPeriod &&
                !academicPeriods.some((p) => p.id === watchedPeriod) && (
                  <SelectItem value={watchedPeriod}>
                    Selected period
                  </SelectItem>
                )}
              {academicPeriods.length === 0 && !watchedPeriod ? (
                <SelectItem value={ZERO_UUID} disabled>
                  No academic periods
                </SelectItem>
              ) : (
                academicPeriods.map((period) => (
                  <SelectItem key={period.id} value={period.id}>
                    {period.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </FormField>

        <FormField
          id="gradingSchemeId"
          label="Grading scheme"
          required
          error={errors.gradingSchemeId?.message ?? null}
        >
          <Select
            value={watchedScheme || undefined}
            onValueChange={(value) =>
              setValue('gradingSchemeId', value, { shouldValidate: true })
            }
          >
            <SelectTrigger id="gradingSchemeId">
              <SelectValue placeholder="Select scheme" />
            </SelectTrigger>
            <SelectContent>
              {schemes.length === 0 ? (
                <SelectItem value={ZERO_UUID} disabled>
                  No schemes
                </SelectItem>
              ) : (
                schemes.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.type})
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </FormField>
      </div>

      <div className="space-y-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-semibold">Items</h2>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {watchedItems.length} of 50 items.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`text-sm font-medium ${
                weightOk
                  ? 'text-emerald-700'
                  : 'text-[hsl(var(--destructive))]'
              }`}
              role="status"
              aria-live="polite"
            >
              Total weight: {totalWeight.toFixed(2)}%
              {!weightOk && (
                <>
                  {' '}
                  (
                  {weightDelta > 0 ? '+' : ''}
                  {weightDelta.toFixed(2)}%)
                </>
              )}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={watchedItems.length >= 50}
              onClick={() =>
                items.append({
                  name: '',
                  weight: 0,
                  minScore: 0,
                  maxScore: 100,
                })
              }
            >
              <Plus className="me-2 h-4 w-4" aria-hidden="true" />
              Add item
            </Button>
          </div>
        </div>

        {typeof errors.items?.message === 'string' && (
          <p
            className="rounded-md border border-[hsl(var(--destructive))]/40 bg-[hsl(var(--destructive))]/10 px-3 py-2 text-xs text-[hsl(var(--destructive))]"
            role="alert"
          >
            {errors.items.message}
          </p>
        )}

        {items.fields.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-[hsl(var(--muted-foreground))]">
            Add at least one assessment item.
          </p>
        ) : (
          <div className="space-y-3">
            {items.fields.map((field, index) => {
              const rowErrors = errors.items?.[index];
              return (
                <div
                  key={field.id}
                  className="grid gap-3 rounded-md border p-3 md:grid-cols-[2fr_120px_120px_120px_auto]"
                  role="group"
                  aria-label={`Assessment item ${index + 1}`}
                >
                  <FormField
                    id={`items.${index}.name`}
                    label="Name"
                    required
                    error={rowErrors?.name?.message ?? null}
                  >
                    <Input
                      id={`items.${index}.name`}
                      placeholder="Quiz 1, Midterm, …"
                      {...register(`items.${index}.name` as const)}
                    />
                  </FormField>
                  <FormField
                    id={`items.${index}.weight`}
                    label="Weight %"
                    required
                    error={rowErrors?.weight?.message ?? null}
                  >
                    <Input
                      id={`items.${index}.weight`}
                      type="number"
                      step="0.01"
                      {...register(`items.${index}.weight` as const, {
                        valueAsNumber: true,
                      })}
                    />
                  </FormField>
                  <FormField
                    id={`items.${index}.minScore`}
                    label="Min"
                    required
                    error={rowErrors?.minScore?.message ?? null}
                  >
                    <Input
                      id={`items.${index}.minScore`}
                      type="number"
                      step="0.01"
                      {...register(`items.${index}.minScore` as const, {
                        valueAsNumber: true,
                      })}
                    />
                  </FormField>
                  <FormField
                    id={`items.${index}.maxScore`}
                    label="Max"
                    required
                    error={rowErrors?.maxScore?.message ?? null}
                  >
                    <Input
                      id={`items.${index}.maxScore`}
                      type="number"
                      step="0.01"
                      {...register(`items.${index}.maxScore` as const, {
                        valueAsNumber: true,
                      })}
                    />
                  </FormField>
                  <div className="flex items-end justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => items.remove(index)}
                      aria-label={`Remove item ${index + 1}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : 'Save items'}
        </Button>
      </div>
    </form>
  );
}
