'use client';

/**
 * Staff appraisal form (Client Component).
 *
 * Loads available appraisal templates and renders one score input per criterion.
 * Submits via the `createAppraisalAction` Server Action.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
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
  Textarea,
} from '@proctira/ui/components';
import {
  appraisalFormSchema,
  type AppraisalFormValues,
} from '@/lib/validation/staff-schema';

import { createAppraisalAction, type ActionState } from '../actions';

interface TemplateOption {
  id: string;
  name: string;
  scoreMin: number;
  scoreMax: number;
  criteria: { name: string; weight: number; maxScore: number }[];
}

interface AppraisalFormProps {
  staffId: string;
  templates: TemplateOption[];
}

const ZERO_UUID = '00000000-0000-4000-8000-000000000000';

export function AppraisalForm({ staffId, templates }: AppraisalFormProps) {
  const router = useRouter();
  const [serverState, setServerState] =
    useState<ActionState<{ appraisalId: string }> | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const defaultTemplate = templates[0];

  const form = useForm<AppraisalFormValues>({
    resolver: zodResolver(appraisalFormSchema),
    defaultValues: {
      templateId: defaultTemplate?.id ?? '',
      appraisalDate: new Date().toISOString().slice(0, 10),
      scores: defaultTemplate
        ? defaultTemplate.criteria.map((c) => ({
            criterionName: c.name,
            score: 0,
            comment: '',
          }))
        : [],
      overallComment: '',
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
    control,
  } = form;

  const scoresArray = useFieldArray({
    control,
    name: 'scores',
  });

  const templateId = watch('templateId');
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templateId, templates],
  );

  // When the template changes, reset score rows to match the criteria.
  useEffect(() => {
    if (!selectedTemplate) return;
    scoresArray.replace(
      selectedTemplate.criteria.map((c) => ({
        criterionName: c.name,
        score: 0,
        comment: '',
      })),
    );
    // intentionally exclude scoresArray (stable per template change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplate?.id]);

  async function onSubmit(values: AppraisalFormValues) {
    setIsPending(true);
    setServerState(null);
    try {
      const result = await createAppraisalAction(staffId, values);
      setServerState(result);
      if (result.status === 'error' && result.fieldErrors) {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          setError(field as keyof AppraisalFormValues, {
            type: 'server',
            message,
          });
        }
      }
      if (result.status === 'success') {
        router.push(`/staff/${staffId}?tab=appraisals`);
        router.refresh();
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form
      data-testid="staff-appraisal-form"
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
        id="templateId"
        label="Appraisal template"
        required
        error={errors.templateId?.message ?? null}
      >
        <Select
          value={templateId || undefined}
          onValueChange={(value) =>
            setValue('templateId', value, { shouldValidate: true })
          }
        >
          <SelectTrigger id="templateId">
            <SelectValue placeholder="Select template" />
          </SelectTrigger>
          <SelectContent>
            {templates.length === 0 ? (
              <SelectItem value={ZERO_UUID} disabled>
                No appraisal templates configured
              </SelectItem>
            ) : (
              templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </FormField>

      <FormField
        id="appraisalDate"
        label="Appraisal date"
        required
        error={errors.appraisalDate?.message ?? null}
      >
        <Input id="appraisalDate" type="date" {...register('appraisalDate')} />
      </FormField>

      {selectedTemplate && (
        <div className="space-y-3 rounded-md border p-4">
          <div className="flex items-center justify-between text-sm text-[hsl(var(--muted-foreground))]">
            <span>
              Score range: {selectedTemplate.scoreMin}–{selectedTemplate.scoreMax}
            </span>
            <span>{selectedTemplate.criteria.length} criteria</span>
          </div>
          {scoresArray.fields.map((field, index) => {
            const criterion = selectedTemplate.criteria[index];
            const rowError = errors.scores?.[index];
            return (
              <div
                key={field.id}
                className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_120px_1fr]"
              >
                <div>
                  <p className="text-sm font-medium">
                    {criterion?.name ?? field.criterionName}
                  </p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    Weight: {criterion?.weight ?? 0}% · Max:{' '}
                    {criterion?.maxScore ?? 0}
                  </p>
                </div>
                <FormField
                  id={`scores.${index}.score`}
                  label="Score"
                  required
                  error={rowError?.score?.message ?? null}
                >
                  <Input
                    id={`scores.${index}.score`}
                    type="number"
                    step="0.01"
                    {...register(`scores.${index}.score` as const, {
                      valueAsNumber: true,
                    })}
                  />
                </FormField>
                <FormField
                  id={`scores.${index}.comment`}
                  label="Comment"
                  error={rowError?.comment?.message ?? null}
                >
                  <Input
                    id={`scores.${index}.comment`}
                    {...register(`scores.${index}.comment` as const)}
                  />
                </FormField>
              </div>
            );
          })}
        </div>
      )}

      <FormField
        id="overallComment"
        label="Overall comment"
        hint="Visible to the staff member after approval. Up to 1000 characters."
        error={errors.overallComment?.message ?? null}
      >
        <Textarea id="overallComment" rows={4} {...register('overallComment')} />
      </FormField>

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
          {isPending ? 'Submitting…' : 'Save appraisal'}
        </Button>
      </div>
    </form>
  );
}
