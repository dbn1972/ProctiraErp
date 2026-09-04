'use client';

/**
 * Survey create / edit form.
 *
 * Layout cues from redesign/web/surveys-list.html (builder CTA) and
 * Transport / Scholarships form patterns. ProctiraERP branding.
 */
import { useMemo, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Plus, Trash2 } from 'lucide-react';

import {
  Button,
  FormField,
  Input,
  Textarea,
} from '@proctira/ui/components';
import type { Survey, SurveyQuestion, SurveyQuestionType } from '@/lib/api/surveys';

import {
  createSurveyAction,
  updateSurveyAction,
  type ActionState,
} from '../actions';

const QUESTION_TYPE_OPTIONS: Array<{ value: SurveyQuestionType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
];

interface SurveyFormProps {
  mode: 'create' | 'edit';
  survey?: Survey;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  );
}

export function SurveyForm({ mode, survey }: SurveyFormProps) {
  const initialQuestions: SurveyQuestion[] = useMemo(() => {
    if (survey?.questions && survey.questions.length > 0) {
      return survey.questions.map((q, idx) => ({
        label: q.label,
        type: q.type,
        required: q.required ?? false,
        order: q.order ?? idx,
      }));
    }
    return [{ label: '', type: 'text', required: true, order: 0 }];
  }, [survey]);

  const [questions, setQuestions] = useState(initialQuestions);

  const boundUpdate =
    mode === 'edit' && survey
      ? updateSurveyAction.bind(null, survey.id)
      : null;

  const [state, formAction] = useFormState<
    ActionState<{ surveyId: string }> | null,
    FormData
  >(
    mode === 'create'
      ? createSurveyAction
      : (boundUpdate as typeof createSurveyAction),
    null,
  );

  function addQuestion() {
    setQuestions((prev) => [
      ...prev,
      { label: '', type: 'text', required: false, order: prev.length },
    ]);
  }

  function removeQuestion(index: number) {
    setQuestions((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== index),
    );
  }

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state?.status === 'error' ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {state.message}
        </p>
      ) : null}

      <FormField id="survey-name" label="Survey name" required error={state?.fieldErrors?.name}>
        <Input
          id="survey-name"
          name="name"
          defaultValue={survey?.name ?? ''}
          placeholder="Mid-Day Meal Feedback"
          required
        />
      </FormField>

      <FormField id="survey-description" label="Description">
        <Textarea
          id="survey-description"
          name="description"
          rows={3}
          defaultValue={survey?.description ?? ''}
          placeholder="What this survey collects and who should respond…"
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="survey-start" label="Start date">
          <Input
            id="survey-start"
            name="startDate"
            type="date"
            defaultValue={survey?.startDate?.slice(0, 10) ?? ''}
          />
        </FormField>
        <FormField id="survey-end" label="End date">
          <Input
            id="survey-end"
            name="endDate"
            type="date"
            defaultValue={survey?.endDate?.slice(0, 10) ?? ''}
          />
        </FormField>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">Questions</p>
            <p className="text-xs text-muted-foreground">
              At least one question is required
              {state?.fieldErrors?.questions
                ? ` · ${state.fieldErrors.questions}`
                : ''}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addQuestion}>
            <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
            Add question
          </Button>
        </div>

        <ul className="space-y-3">
          {questions.map((q, index) => (
            <li
              key={`q-${index}`}
              className="rounded-lg border border-border bg-muted/20 p-4"
            >
              <div className="flex flex-wrap items-start gap-3">
                <span className="mt-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-3">
                  <FormField
                    id={`question-label-${index}`}
                    label="Label"
                    required
                  >
                    <Input
                      id={`question-label-${index}`}
                      name="questionLabel"
                      defaultValue={q.label}
                      placeholder="How satisfied are you with…?"
                      required
                    />
                  </FormField>
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                    <FormField id={`question-type-${index}`} label="Type">
                      <select
                        id={`question-type-${index}`}
                        name="questionType"
                        defaultValue={q.type}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        {QUESTION_TYPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <label className="flex items-end gap-2 pb-2 text-sm">
                      <input
                        type="hidden"
                        name={`questionRequired_${index}`}
                        value="false"
                      />
                      <input
                        type="checkbox"
                        name={`questionRequired_${index}`}
                        value="true"
                        defaultChecked={q.required}
                        className="h-4 w-4 rounded border-input"
                      />
                      Required
                    </label>
                    <div className="flex items-end pb-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeQuestion(index)}
                        disabled={questions.length <= 1}
                        aria-label={`Remove question ${index + 1}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <SubmitButton
          label={mode === 'create' ? 'Create survey' : 'Save changes'}
        />
      </div>
    </form>
  );
}
