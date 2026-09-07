'use client';

/**
 * Grading Scheme create / edit form (Client Component).
 *
 * - Validates with zod (mirrors backend Typebox).
 * - Supports numeric / letter / competency schemes with threshold rows.
 * - Submits via the corresponding Server Action.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
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
  gradingSchemeFormSchema,
  type GradingSchemeFormValues,
} from '@/lib/validation/assessment-schema';

import {
  createGradingSchemeAction,
  updateGradingSchemeAction,
  type ActionState,
} from '../actions';

interface GradingSchemeFormProps {
  mode: 'create' | 'edit';
  schemeId?: string;
  initialValues: GradingSchemeFormValues;
}

const SCHEME_TYPE_OPTIONS = [
  { value: 'numeric', label: 'Numeric (score-based)' },
  { value: 'letter', label: 'Letter grades' },
  { value: 'competency', label: 'Competency levels' },
];

export function GradingSchemeForm({
  mode,
  schemeId,
  initialValues,
}: GradingSchemeFormProps) {
  const router = useRouter();
  const [serverState, setServerState] =
    useState<ActionState<{ schemeId: string }> | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const form = useForm<GradingSchemeFormValues>({
    resolver: zodResolver(gradingSchemeFormSchema),
    defaultValues: initialValues,
    mode: 'onBlur',
  });
  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
    setValue,
    control,
    watch,
  } = form;

  const thresholds = useFieldArray({ control, name: 'thresholds' });
  const type = watch('type');

  async function onSubmit(values: GradingSchemeFormValues) {
    setIsPending(true);
    setServerState(null);
    try {
      const result =
        mode === 'create'
          ? await createGradingSchemeAction(values)
          : await updateGradingSchemeAction(schemeId ?? '', values);
      setServerState(result);
      if (result.status === 'error' && result.fieldErrors) {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          setError(field as keyof GradingSchemeFormValues, {
            type: 'server',
            message,
          });
        }
      }
      if (result.status === 'success') {
        router.push('/assessments');
        router.refresh();
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form
      data-testid="grading-scheme-form"
      data-hydrated={hydrated ? 'true' : 'false'}
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

      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          id="name"
          label="Scheme name"
          required
          error={errors.name?.message ?? null}
        >
          <Input id="name" {...register('name')} />
        </FormField>

        <FormField
          id="type"
          label="Scheme type"
          required
          error={errors.type?.message ?? null}
        >
          <Select
            value={type}
            onValueChange={(value) =>
              setValue('type', value as GradingSchemeFormValues['type'], {
                shouldValidate: true,
              })
            }
          >
            <SelectTrigger id="type">
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              {SCHEME_TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField
          id="minValue"
          label="Min value"
          required
          error={errors.minValue?.message ?? null}
        >
          <Input
            id="minValue"
            type="number"
            step="0.01"
            {...register('minValue', { valueAsNumber: true })}
          />
        </FormField>

        <FormField
          id="maxValue"
          label="Max value"
          required
          error={errors.maxValue?.message ?? null}
        >
          <Input
            id="maxValue"
            type="number"
            step="0.01"
            {...register('maxValue', { valueAsNumber: true })}
          />
        </FormField>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Thresholds</h2>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Define the score range that maps to each grade label.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              thresholds.append({
                grade: '',
                minScore: 0,
                maxScore: 0,
                descriptor: '',
              })
            }
          >
            <Plus className="me-2 h-4 w-4" aria-hidden="true" />
            Add threshold
          </Button>
        </div>

        {thresholds.fields.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-[hsl(var(--muted-foreground))]">
            Add at least one grade threshold.
          </p>
        ) : (
          <div className="space-y-3">
            {thresholds.fields.map((field, index) => {
              const rowErrors = errors.thresholds?.[index];
              return (
                <div
                  key={field.id}
                  className="grid gap-3 rounded-md border p-3 md:grid-cols-[120px_120px_120px_1fr_auto]"
                  role="group"
                  aria-label={`Threshold ${index + 1}`}
                >
                  <FormField
                    id={`thresholds.${index}.grade`}
                    label="Grade"
                    required
                    error={rowErrors?.grade?.message ?? null}
                  >
                    <Input
                      id={`thresholds.${index}.grade`}
                      placeholder="A"
                      {...register(`thresholds.${index}.grade` as const)}
                    />
                  </FormField>
                  <FormField
                    id={`thresholds.${index}.minScore`}
                    label="Min"
                    required
                    error={rowErrors?.minScore?.message ?? null}
                  >
                    <Input
                      id={`thresholds.${index}.minScore`}
                      type="number"
                      step="0.01"
                      {...register(`thresholds.${index}.minScore` as const, {
                        valueAsNumber: true,
                      })}
                    />
                  </FormField>
                  <FormField
                    id={`thresholds.${index}.maxScore`}
                    label="Max"
                    required
                    error={rowErrors?.maxScore?.message ?? null}
                  >
                    <Input
                      id={`thresholds.${index}.maxScore`}
                      type="number"
                      step="0.01"
                      {...register(`thresholds.${index}.maxScore` as const, {
                        valueAsNumber: true,
                      })}
                    />
                  </FormField>
                  <FormField
                    id={`thresholds.${index}.descriptor`}
                    label="Descriptor (optional)"
                    error={rowErrors?.descriptor?.message ?? null}
                  >
                    <Input
                      id={`thresholds.${index}.descriptor`}
                      placeholder="Excellent, proficient…"
                      {...register(`thresholds.${index}.descriptor` as const)}
                    />
                  </FormField>
                  <div className="flex items-end justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => thresholds.remove(index)}
                      aria-label={`Remove threshold ${index + 1}`}
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
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isPending}
          data-testid="grading-scheme-submit"
        >
          {isPending
            ? mode === 'create'
              ? 'Creating…'
              : 'Saving…'
            : mode === 'create'
              ? 'Create scheme'
              : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
