'use client';

/**
 * Examination create form aligned with backend CreateExaminationSchema.
 * Submits via createExaminationAction → POST /examinations (gateway plugin).
 * Does not invent success — gateway failures surface as honest errors.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@proctira/ui/components';
import {
  createExaminationFormSchema,
  defaultCreateExaminationValues,
  type CreateExaminationFormValues,
} from '@/lib/validation/examination-schema';

import {
  createExaminationAction,
  type ActionState,
} from '../actions';

export interface InstitutionOption {
  id: string;
  name: string;
  code: string;
}

interface NewExaminationFormProps {
  institutions: InstitutionOption[];
}

type FieldErrors = Record<string, string>;

function flattenClientErrors(
  issues: { path: PropertyKey[]; message: string }[],
): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || '_form';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function NewExaminationForm({ institutions }: NewExaminationFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<CreateExaminationFormValues>(() =>
    defaultCreateExaminationValues(institutions[0]?.id ?? ''),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverState, setServerState] = useState<ActionState<{
    examinationId: string;
  }> | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  function patchRoot<K extends keyof CreateExaminationFormValues>(
    key: K,
    value: CreateExaminationFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerState(null);
    const parsed = createExaminationFormSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(flattenClientErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setIsPending(true);
    try {
      const result = await createExaminationAction(parsed.data);
      setServerState(result);
      if (result.status === 'success' && result.data?.examinationId) {
        router.push(`/examinations/${result.data.examinationId}`);
        router.refresh();
      }
      if (result.status === 'error' && result.fieldErrors) {
        setErrors(result.fieldErrors);
      }
    } finally {
      setIsPending(false);
    }
  }

  const subject = values.subjects[0]!;
  const center = values.centers[0]!;
  const scheme = values.gradingSchemes[0]!;

  return (
    <section aria-labelledby="new-exam-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/examinations">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to examinations
        </Link>
      </Button>

      <div>
        <h1
          id="new-exam-heading"
          className="text-3xl font-extrabold tracking-tight text-foreground"
        >
          Schedule examination
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Creates via POST /examinations — name, code, academic period, window,
          subject, centre, and grading scheme (Requirement 10.1 / 10.7).
        </p>
      </div>

      <Card className="max-w-[860px]">
        <CardHeader>
          <CardTitle className="text-base">Examination details</CardTitle>
          <CardDescription>
            Start date must be at least 7 days ahead. Fields marked * are
            required.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-6"
            noValidate
            onSubmit={onSubmit}
            data-testid="examination-create-form"
            data-hydrated={hydrated ? 'true' : 'false'}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <FormField id="exam-name" label="Name" required error={errors.name}>
                <Input
                  id="exam-name"
                  name="name"
                  value={values.name}
                  onChange={(e) => patchRoot('name', e.target.value)}
                  placeholder="Final Year Examination"
                  aria-invalid={Boolean(errors.name)}
                />
              </FormField>
              <FormField id="exam-code" label="Code" required error={errors.code}>
                <Input
                  id="exam-code"
                  name="code"
                  value={values.code}
                  onChange={(e) => patchRoot('code', e.target.value)}
                  placeholder="FYE-2026"
                  aria-invalid={Boolean(errors.code)}
                />
              </FormField>
            </div>

            <FormField
              id="exam-description"
              label="Description"
              error={errors.description}
            >
              <Input
                id="exam-description"
                name="description"
                value={values.description ?? ''}
                onChange={(e) => patchRoot('description', e.target.value)}
                placeholder="Optional summary"
              />
            </FormField>

            <FormField
              id="exam-period"
              label="Academic period ID"
              required
              error={errors.academicPeriodId}
            >
              <Input
                id="exam-period"
                name="academicPeriodId"
                value={values.academicPeriodId}
                onChange={(e) => patchRoot('academicPeriodId', e.target.value)}
                placeholder="UUID v4 of the academic period"
                aria-invalid={Boolean(errors.academicPeriodId)}
                data-testid="examination-academic-period"
              />
            </FormField>

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                id="exam-start"
                label="Start date"
                required
                error={errors.startDate}
              >
                <Input
                  id="exam-start"
                  name="startDate"
                  type="date"
                  value={values.startDate}
                  onChange={(e) => patchRoot('startDate', e.target.value)}
                  aria-invalid={Boolean(errors.startDate)}
                  data-testid="examination-start-date"
                />
              </FormField>
              <FormField
                id="exam-end"
                label="End date"
                required
                error={errors.endDate}
              >
                <Input
                  id="exam-end"
                  name="endDate"
                  type="date"
                  value={values.endDate}
                  onChange={(e) => patchRoot('endDate', e.target.value)}
                  aria-invalid={Boolean(errors.endDate)}
                  data-testid="examination-end-date"
                />
              </FormField>
            </div>

            <fieldset className="space-y-3 rounded-lg border border-border p-4">
              <legend className="px-1 text-sm font-semibold">Subject *</legend>
              <div className="grid gap-4 md:grid-cols-3">
                <FormField
                  id="subject-name"
                  label="Name"
                  required
                  error={errors['subjects.0.name']}
                >
                  <Input
                    id="subject-name"
                    value={subject.name}
                    onChange={(e) =>
                      patchRoot('subjects', [
                        { ...subject, name: e.target.value },
                      ])
                    }
                    placeholder="Mathematics"
                    data-testid="examination-subject-name"
                  />
                </FormField>
                <FormField
                  id="subject-code"
                  label="Code"
                  required
                  error={errors['subjects.0.code']}
                >
                  <Input
                    id="subject-code"
                    value={subject.code}
                    onChange={(e) =>
                      patchRoot('subjects', [
                        { ...subject, code: e.target.value },
                      ])
                    }
                    placeholder="MATH"
                    data-testid="examination-subject-code"
                  />
                </FormField>
                <FormField
                  id="subject-max"
                  label="Max score"
                  required
                  error={errors['subjects.0.maxScore']}
                >
                  <Input
                    id="subject-max"
                    type="number"
                    min={1}
                    value={subject.maxScore}
                    onChange={(e) =>
                      patchRoot('subjects', [
                        {
                          ...subject,
                          maxScore: Number(e.target.value) || 0,
                        },
                      ])
                    }
                  />
                </FormField>
              </div>
            </fieldset>

            <fieldset className="space-y-3 rounded-lg border border-border p-4">
              <legend className="px-1 text-sm font-semibold">Centre *</legend>
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  id="center-name"
                  label="Name"
                  required
                  error={errors['centers.0.name']}
                >
                  <Input
                    id="center-name"
                    value={center.name}
                    onChange={(e) =>
                      patchRoot('centers', [
                        { ...center, name: e.target.value },
                      ])
                    }
                    placeholder="Main campus hall"
                    data-testid="examination-center-name"
                  />
                </FormField>
                <FormField
                  id="center-code"
                  label="Code"
                  required
                  error={errors['centers.0.code']}
                >
                  <Input
                    id="center-code"
                    value={center.code}
                    onChange={(e) =>
                      patchRoot('centers', [
                        { ...center, code: e.target.value },
                      ])
                    }
                    placeholder="CTR-A"
                    data-testid="examination-center-code"
                  />
                </FormField>
                <FormField
                  id="center-institution"
                  label="Institution"
                  required
                  error={errors['centers.0.institutionId']}
                >
                  {institutions.length > 0 ? (
                    <Select
                      value={center.institutionId || undefined}
                      onValueChange={(v) =>
                        patchRoot('centers', [
                          { ...center, institutionId: v },
                        ])
                      }
                    >
                      <SelectTrigger
                        id="center-institution"
                        data-testid="examination-center-institution"
                      >
                        <SelectValue placeholder="Select institution" />
                      </SelectTrigger>
                      <SelectContent>
                        {institutions.map((inst) => (
                          <SelectItem key={inst.id} value={inst.id}>
                            {inst.name} ({inst.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id="center-institution"
                      value={center.institutionId}
                      onChange={(e) =>
                        patchRoot('centers', [
                          { ...center, institutionId: e.target.value },
                        ])
                      }
                      placeholder="Institution UUID v4"
                      data-testid="examination-center-institution"
                    />
                  )}
                </FormField>
                <FormField
                  id="center-capacity"
                  label="Capacity"
                  required
                  error={errors['centers.0.capacity']}
                >
                  <Input
                    id="center-capacity"
                    type="number"
                    min={1}
                    value={center.capacity}
                    onChange={(e) =>
                      patchRoot('centers', [
                        {
                          ...center,
                          capacity: Number(e.target.value) || 0,
                        },
                      ])
                    }
                  />
                </FormField>
              </div>
            </fieldset>

            <fieldset className="space-y-3 rounded-lg border border-border p-4">
              <legend className="px-1 text-sm font-semibold">
                Grading scheme *
              </legend>
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  id="scheme-name"
                  label="Name"
                  required
                  error={errors['gradingSchemes.0.name']}
                >
                  <Input
                    id="scheme-name"
                    value={scheme.name}
                    onChange={(e) =>
                      patchRoot('gradingSchemes', [
                        { ...scheme, name: e.target.value },
                      ])
                    }
                  />
                </FormField>
                <FormField
                  id="scheme-pass"
                  label="Pass threshold"
                  required
                  error={errors['gradingSchemes.0.passThreshold']}
                >
                  <Input
                    id="scheme-pass"
                    type="number"
                    min={0}
                    value={scheme.passThreshold}
                    onChange={(e) =>
                      patchRoot('gradingSchemes', [
                        {
                          ...scheme,
                          passThreshold: Number(e.target.value) || 0,
                        },
                      ])
                    }
                  />
                </FormField>
              </div>
              <p className="text-xs text-muted-foreground">
                Default A/B/C/F thresholds (0–100) are included; adjust the pass
                threshold if needed.
              </p>
            </fieldset>

            {serverState?.status === 'error' && serverState.message ? (
              <p
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-950"
                role="alert"
                data-testid="examination-create-error"
              >
                {serverState.message}
              </p>
            ) : null}

            {serverState?.status === 'success' ? (
              <p
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950"
                role="status"
                data-testid="examination-create-success"
              >
                Examination created — opening detail…
              </p>
            ) : null}

            <div className="flex justify-end gap-3 pt-2">
              <Button asChild variant="outline" type="button">
                <Link href="/examinations">Cancel</Link>
              </Button>
              <Button
                type="submit"
                disabled={isPending}
                data-testid="examination-create-submit"
              >
                {isPending ? 'Creating…' : 'Create examination'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
