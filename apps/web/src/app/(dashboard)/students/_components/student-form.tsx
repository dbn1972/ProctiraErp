'use client';

/**
 * Reusable Student create / edit form (Client Component).
 *
 * - Validation via react-hook-form + zod (mirrors backend Typebox schema).
 * - Submits via the matching Server Action (create or update).
 * - Renders dynamic custom fields fetched from the custom-field service.
 * - Auto-saves the in-progress form to `localStorage` every 30 s
 *   (Task 60.5, Requirement 38 AC 8). The draft slot is keyed
 *   `student-create` for new students or `student-edit-<studentId>`
 *   for an edit, so closing the browser, losing power, or losing
 *   connectivity does not result in data loss for the in-progress
 *   form. The draft is hydrated on mount, flushed on submit, and
 *   cleared on a successful save.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Plus, Trash2, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useFieldArray, useForm, type Control, type FieldErrors, type UseFormRegister } from 'react-hook-form';

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
  Textarea,
} from '@proctira/ui/components';
import type { CustomFieldDefinition } from '@/lib/api/students';
import { useDraftAutosave } from '@/lib/draft/useDraftAutosave';
import {
  studentFormSchema,
  type StudentFormValues,
} from '@/lib/validation/student-schema';
import {
  createStudentAction,
  updateStudentAction,
  type ActionState,
} from '../actions';

interface StudentFormProps {
  mode: 'create' | 'edit';
  studentId?: string;
  initialValues: StudentFormValues;
  customFields: CustomFieldDefinition[];
}

const GENDER_OPTIONS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const CONTACT_TYPES = [
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'address', label: 'Address' },
];

const DOCUMENT_TYPES = [
  { value: 'passport', label: 'Passport' },
  { value: 'national_id', label: 'National ID' },
  { value: 'birth_certificate', label: 'Birth certificate' },
  { value: 'other', label: 'Other' },
];

export function StudentForm({
  mode,
  studentId,
  initialValues,
  customFields,
}: StudentFormProps) {
  const router = useRouter();
  const [serverState, setServerState] = useState<ActionState<{ studentId: string }> | null>(null);
  const [isPending, setIsPending] = useState(false);

  // Draft autosave (Task 60.5 / Requirement 38.8).
  //
  // Slot key:
  //   • `student-create`         — new students (no id yet).
  //   • `student-edit-<id>`      — existing students, scoped per id.
  //
  // The hook reads the persisted snapshot once on mount; we use that
  // (when present) to seed react-hook-form's `defaultValues`. Saves
  // are debounced inside the hook to 30 s, flushed on submit, and
  // cleared on a successful response so the next visit starts clean.
  const draftFormId =
    mode === 'create' ? 'student-create' : `student-edit-${studentId ?? ''}`;
  const draft = useDraftAutosave<StudentFormValues>(draftFormId);

  const form = useForm<StudentFormValues>({
    resolver: zodResolver(studentFormSchema),
    defaultValues: draft.values ?? initialValues,
    mode: 'onBlur',
  });
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
    setError,
    setValue,
    watch,
    reset,
  } = form;

  // Replay the persisted draft into the form once the autosave layer
  // hydrates client-side. `useDraftAutosave` returns `null` on the
  // first SSR render and re-reads from `localStorage` in a mount
  // effect; if a draft exists we replace the server-supplied
  // `initialValues` with it so the user can pick up where they left
  // off without manually re-entering anything.
  const hasHydratedDraftRef = useRef<boolean>(false);
  useEffect(() => {
    if (hasHydratedDraftRef.current) return;
    if (draft.values !== null) {
      reset(draft.values);
      hasHydratedDraftRef.current = true;
    }
  }, [draft.values, reset]);

  // Persist every form mutation. `watch()` with no arguments emits on
  // any field change; the autosave hook itself debounces to 30 s so
  // this stays cheap. We deliberately persist the entire shape so
  // partially-completed nested arrays (contacts, guardians, identity
  // documents) survive a refresh.
  useEffect(() => {
    const subscription = watch((values) => {
      draft.save(values as StudentFormValues);
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [watch, draft]);

  const guardians = useFieldArray({ control, name: 'guardians' });
  const contacts = useFieldArray({ control, name: 'contacts' });
  const documents = useFieldArray({ control, name: 'identityDocuments' });

  async function onSubmit(values: StudentFormValues) {
    setIsPending(true);
    setServerState(null);
    // Flush the autosave so a crash during the network round-trip
    // still leaves a recoverable snapshot, then submit.
    draft.flush(values);
    try {
      const result =
        mode === 'create'
          ? await createStudentAction(values)
          : await updateStudentAction(studentId ?? '', values);
      setServerState(result);
      if (result.status === 'error' && result.fieldErrors) {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          setError(field as keyof StudentFormValues, { type: 'server', message });
        }
      }
      if (result.status === 'success' && result.data?.studentId) {
        // Successful save — discard the persisted draft so revisiting
        // the form starts clean. The redirect happens immediately
        // afterwards so the user does not see the empty form.
        draft.clear();
        router.push(`/students/${result.data.studentId}`);
        router.refresh();
      }
    } finally {
      setIsPending(false);
    }
  }

  const customDataValues = watch('customData') ?? {};

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

      <Card className="max-w-[880px]">
        <CardHeader className="pb-4">
          <CardTitle>Personal details</CardTitle>
          <CardDescription>
            Name and date of birth are required. National ID is used for
            duplicate detection across all institutions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Photo drop / current photo */}
          <div className="mb-6 flex items-center gap-4 rounded-xl border-2 border-dashed border-border bg-muted/30 p-4 transition-colors hover:border-primary/40">
            <span
              aria-hidden="true"
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
            >
              <User className="h-7 w-7" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Drop a passport-size photo here, or browse</p>
              <p className="text-xs text-muted-foreground">
                JPG or PNG, up to 2 MB · plain background preferred ·
                photo is saved after the student record is created
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" disabled>
              Browse files
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              id="firstName"
              label="First name"
              required
              error={errors.firstName?.message ?? null}
            >
              <Input
                id="firstName"
                autoComplete="given-name"
                aria-invalid={Boolean(errors.firstName)}
                {...register('firstName')}
              />
            </FormField>

            <FormField
              id="lastName"
              label="Last name"
              required
              error={errors.lastName?.message ?? null}
            >
              <Input
                id="lastName"
                autoComplete="family-name"
                aria-invalid={Boolean(errors.lastName)}
                {...register('lastName')}
              />
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
                aria-invalid={Boolean(errors.dateOfBirth)}
                {...register('dateOfBirth')}
              />
            </FormField>

            <FormField
              id="gender"
              label="Gender"
              required
              error={errors.gender?.message ?? null}
            >
              <Select
                value={watch('gender') || ''}
                onValueChange={(value) => setValue('gender', value, { shouldValidate: true })}
              >
                <SelectTrigger id="gender">
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  {GENDER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField
              id="nationalId"
              label="National ID"
              hint="Used for duplicate detection."
              error={errors.nationalId?.message ?? null}
            >
              <Input id="nationalId" {...register('nationalId')} />
            </FormField>

            <FormField
              id="nationality"
              label="Nationality"
              error={errors.nationality?.message ?? null}
            >
              <Input id="nationality" {...register('nationality')} />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-[880px]">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Contacts</CardTitle>
            <CardDescription>Phone numbers and emails for the student.</CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              contacts.append({ type: 'phone', value: '', isPrimary: false })
            }
          >
            <Plus className="me-2 h-4 w-4" aria-hidden="true" />
            Add contact
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {contacts.fields.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              No contacts on file.
            </p>
          ) : (
            contacts.fields.map((field, index) => (
              <ContactRow
                key={field.id}
                index={index}
                register={register}
                errors={errors}
                onRemove={() => contacts.remove(index)}
              />
            ))
          )}
        </CardContent>
      </Card>

      <Card className="max-w-[880px]">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Guardian</CardTitle>
            <CardDescription>
              Parents or other guardians. Attendance and fee alerts are sent to
              the primary guardian's phone.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              guardians.append({
                firstName: '',
                lastName: '',
                relationship: '',
                contactPhone: '',
                contactEmail: '',
              })
            }
          >
            <Plus className="me-2 h-4 w-4" aria-hidden="true" />
            Add guardian
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {guardians.fields.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              No guardians on file.
            </p>
          ) : (
            guardians.fields.map((field, index) => (
              <GuardianRow
                key={field.id}
                index={index}
                register={register}
                errors={errors}
                onRemove={() => guardians.remove(index)}
              />
            ))
          )}
        </CardContent>
      </Card>

      <Card className="max-w-[880px]">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Identity documents</CardTitle>
            <CardDescription>Passport, birth certificate, or other official documents.</CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              documents.append({
                type: 'passport',
                number: '',
                issuingCountry: '',
                expiryDate: '',
              })
            }
          >
            <Plus className="me-2 h-4 w-4" aria-hidden="true" />
            Add document
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {documents.fields.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              No identity documents recorded.
            </p>
          ) : (
            documents.fields.map((field, index) => (
              <DocumentRow
                key={field.id}
                index={index}
                register={register}
                errors={errors}
                control={control}
                onRemove={() => documents.remove(index)}
              />
            ))
          )}
        </CardContent>
      </Card>

      {customFields.length > 0 && (
        <Card className="max-w-[880px]">
          <CardHeader>
            <CardTitle>Custom fields</CardTitle>
            <CardDescription>
              Tenant-defined fields configured by your administrators.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {customFields.map((field) => (
              <CustomFieldInput
                key={field.id}
                field={field}
                value={customDataValues[field.fieldKey]}
                onChange={(value) =>
                  setValue(`customData.${field.fieldKey}`, value, {
                    shouldDirty: true,
                  })
                }
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Sticky save footer */}
      <div
        className="sticky bottom-4 z-20 max-w-[880px] overflow-hidden rounded-xl border border-border bg-background/90 shadow-lg backdrop-blur"
        aria-label="Save actions"
      >
        <div className="flex flex-wrap items-center gap-2 px-5 py-3">
          <p className="me-auto text-xs text-muted-foreground">
            Fields marked{' '}
            <span className="text-destructive" aria-hidden="true">*</span>{' '}
            are required · all changes are recorded in the audit trail
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            disabled={isPending}
          >
            Cancel
          </Button>
          {mode === 'create' && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => {
                void handleSubmit((values) => onSubmit(values))();
              }}
            >
              Save &amp; add another
            </Button>
          )}
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? (
              mode === 'create' ? 'Creating…' : 'Saving…'
            ) : (
              <>
                <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
                {mode === 'create' ? 'Save student' : 'Save changes'}
              </>
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}

interface ContactRowProps {
  index: number;
  register: UseFormRegister<StudentFormValues>;
  errors: FieldErrors<StudentFormValues>;
  onRemove: () => void;
}

function ContactRow({ index, register, errors, onRemove }: ContactRowProps) {
  const rowErrors = errors.contacts?.[index];
  return (
    <div
      className="grid gap-3 rounded-md border p-3 md:grid-cols-[140px_1fr_120px_auto]"
      role="group"
      aria-label={`Contact ${index + 1}`}
    >
      <FormField
        id={`contacts.${index}.type`}
        label="Type"
        required
        error={rowErrors?.type?.message ?? null}
      >
        <select
          id={`contacts.${index}.type`}
          {...register(`contacts.${index}.type` as const)}
          className="h-10 w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm"
        >
          {CONTACT_TYPES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField
        id={`contacts.${index}.value`}
        label="Value"
        required
        error={rowErrors?.value?.message ?? null}
      >
        <Input
          id={`contacts.${index}.value`}
          {...register(`contacts.${index}.value` as const)}
        />
      </FormField>
      <FormField
        id={`contacts.${index}.isPrimary`}
        label="Primary"
      >
        <label className="flex h-10 items-center gap-2 text-sm">
          <input
            id={`contacts.${index}.isPrimary`}
            type="checkbox"
            {...register(`contacts.${index}.isPrimary` as const)}
            className="h-4 w-4"
          />
          Mark primary
        </label>
      </FormField>
      <div className="flex items-end justify-end">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label={`Remove contact ${index + 1}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

interface GuardianRowProps {
  index: number;
  register: UseFormRegister<StudentFormValues>;
  errors: FieldErrors<StudentFormValues>;
  onRemove: () => void;
}

function GuardianRow({ index, register, errors, onRemove }: GuardianRowProps) {
  const rowErrors = errors.guardians?.[index];
  return (
    <div
      className="grid gap-3 rounded-md border p-3 md:grid-cols-2"
      role="group"
      aria-label={`Guardian ${index + 1}`}
    >
      <FormField
        id={`guardians.${index}.firstName`}
        label="First name"
        required
        error={rowErrors?.firstName?.message ?? null}
      >
        <Input
          id={`guardians.${index}.firstName`}
          {...register(`guardians.${index}.firstName` as const)}
        />
      </FormField>
      <FormField
        id={`guardians.${index}.lastName`}
        label="Last name"
        required
        error={rowErrors?.lastName?.message ?? null}
      >
        <Input
          id={`guardians.${index}.lastName`}
          {...register(`guardians.${index}.lastName` as const)}
        />
      </FormField>
      <FormField
        id={`guardians.${index}.relationship`}
        label="Relationship"
        required
        error={rowErrors?.relationship?.message ?? null}
      >
        <Input
          id={`guardians.${index}.relationship`}
          placeholder="Mother, father, uncle…"
          {...register(`guardians.${index}.relationship` as const)}
        />
      </FormField>
      <FormField
        id={`guardians.${index}.contactPhone`}
        label="Phone"
        error={rowErrors?.contactPhone?.message ?? null}
      >
        <Input
          id={`guardians.${index}.contactPhone`}
          type="tel"
          {...register(`guardians.${index}.contactPhone` as const)}
        />
      </FormField>
      <FormField
        id={`guardians.${index}.contactEmail`}
        label="Email"
        error={rowErrors?.contactEmail?.message ?? null}
      >
        <Input
          id={`guardians.${index}.contactEmail`}
          type="email"
          {...register(`guardians.${index}.contactEmail` as const)}
        />
      </FormField>
      <div className="md:col-span-2 flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label={`Remove guardian ${index + 1}`}
        >
          <Trash2 className="me-2 h-4 w-4" aria-hidden="true" />
          Remove guardian
        </Button>
      </div>
    </div>
  );
}

interface DocumentRowProps {
  index: number;
  register: UseFormRegister<StudentFormValues>;
  errors: FieldErrors<StudentFormValues>;
  control: Control<StudentFormValues>;
  onRemove: () => void;
}

function DocumentRow({ index, register, errors, onRemove }: DocumentRowProps) {
  const rowErrors = errors.identityDocuments?.[index];
  return (
    <div
      className="grid gap-3 rounded-md border p-3 md:grid-cols-2"
      role="group"
      aria-label={`Identity document ${index + 1}`}
    >
      <FormField
        id={`identityDocuments.${index}.type`}
        label="Type"
        required
        error={rowErrors?.type?.message ?? null}
      >
        <select
          id={`identityDocuments.${index}.type`}
          {...register(`identityDocuments.${index}.type` as const)}
          className="h-10 w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm"
        >
          {DOCUMENT_TYPES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField
        id={`identityDocuments.${index}.number`}
        label="Number"
        required
        error={rowErrors?.number?.message ?? null}
      >
        <Input
          id={`identityDocuments.${index}.number`}
          {...register(`identityDocuments.${index}.number` as const)}
        />
      </FormField>
      <FormField
        id={`identityDocuments.${index}.issuingCountry`}
        label="Issuing country"
        error={rowErrors?.issuingCountry?.message ?? null}
      >
        <Input
          id={`identityDocuments.${index}.issuingCountry`}
          {...register(`identityDocuments.${index}.issuingCountry` as const)}
        />
      </FormField>
      <FormField
        id={`identityDocuments.${index}.expiryDate`}
        label="Expiry date"
        error={rowErrors?.expiryDate?.message ?? null}
      >
        <Input
          id={`identityDocuments.${index}.expiryDate`}
          type="date"
          {...register(`identityDocuments.${index}.expiryDate` as const)}
        />
      </FormField>
      <div className="md:col-span-2 flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label={`Remove document ${index + 1}`}
        >
          <Trash2 className="me-2 h-4 w-4" aria-hidden="true" />
          Remove document
        </Button>
      </div>
    </div>
  );
}

interface CustomFieldInputProps {
  field: CustomFieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
}

function CustomFieldInput({ field, value, onChange }: CustomFieldInputProps) {
  const id = `custom-${field.fieldKey}`;
  const error: string | null = null;
  const required = field.validationRules?.required === true;
  const hint = field.description ?? undefined;

  switch (field.fieldType) {
    case 'textarea':
      return (
        <FormField id={id} label={field.label} required={required} hint={hint} error={error}>
          <Textarea
            id={id}
            value={(value as string) ?? ''}
            onChange={(event) => onChange(event.target.value)}
          />
        </FormField>
      );
    case 'number':
      return (
        <FormField id={id} label={field.label} required={required} hint={hint} error={error}>
          <Input
            id={id}
            type="number"
            value={(value as string | number | undefined) ?? ''}
            onChange={(event) =>
              onChange(event.target.value === '' ? '' : Number(event.target.value))
            }
          />
        </FormField>
      );
    case 'date':
      return (
        <FormField id={id} label={field.label} required={required} hint={hint} error={error}>
          <Input
            id={id}
            type="date"
            value={(value as string) ?? ''}
            onChange={(event) => onChange(event.target.value)}
          />
        </FormField>
      );
    case 'checkbox':
      return (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => onChange(event.target.checked)}
            className="h-4 w-4"
          />
          <label htmlFor={id} className="text-sm font-medium">
            {field.label}
            {required && <span className="ms-0.5 text-[hsl(var(--destructive))]">*</span>}
          </label>
        </div>
      );
    case 'dropdown':
      return (
        <FormField id={id} label={field.label} required={required} hint={hint} error={error}>
          <select
            id={id}
            value={(value as string) ?? ''}
            onChange={(event) => onChange(event.target.value)}
            className="h-10 w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm"
          >
            <option value="">Select…</option>
            {(field.validationRules?.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </FormField>
      );
    case 'file':
      return (
        <FormField id={id} label={field.label} required={required} hint={hint} error={error}>
          <Input id={id} type="file" disabled />
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            File uploads are saved separately after the student is created.
          </p>
        </FormField>
      );
    case 'text':
    default:
      return (
        <FormField id={id} label={field.label} required={required} hint={hint} error={error}>
          <Input
            id={id}
            value={(value as string) ?? ''}
            onChange={(event) => onChange(event.target.value)}
          />
        </FormField>
      );
  }
}
