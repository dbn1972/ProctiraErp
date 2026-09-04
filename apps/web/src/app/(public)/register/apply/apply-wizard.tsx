'use client';

/**
 * Multi-step registration wizard — Personal → Documents → Review.
 * Matches redesign/registration/apply-school*.html with ProctiraERP branding.
 */

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  Loader2,
  Send,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';

import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Input,
  Label,
} from '@proctira/ui/components';
import {
  submitRegistration,
  type DocumentUploadMetadata,
} from '@/lib/api/registration';

const STORAGE_KEY = 'proctira-register-draft';
const TRACKING_KEY = 'registration:lastTrackingNumber';

type Step = 'personal' | 'documents' | 'review';

interface Draft {
  institutionId: string;
  institutionName: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: 'male' | 'female' | 'other' | '';
  gradeApplying: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  address: string;
  documents: DocumentUploadMetadata[];
}

const EMPTY: Draft = {
  institutionId: '',
  institutionName: '',
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  gender: '',
  gradeApplying: 'Class 1',
  guardianName: '',
  guardianPhone: '',
  guardianEmail: '',
  address: '',
  documents: [],
};

const DOC_TYPES = [
  {
    id: 'birth_certificate',
    label: 'Birth certificate',
    hint: 'Issued by the municipality, panchayat, or hospital · PDF or JPG, up to 5 MB',
    required: true,
    accept: 'image/jpeg,image/png,application/pdf',
  },
  {
    id: 'address_proof',
    label: 'Address proof',
    hint: 'Ration card, voter ID, electricity bill, or Aadhaar · PDF or JPG, up to 5 MB',
    required: true,
    accept: 'image/jpeg,image/png,application/pdf',
  },
  {
    id: 'caste_certificate',
    label: 'Caste certificate',
    hint: 'Optional — for scholarship benefits · PDF or JPG, up to 5 MB',
    required: false,
    accept: 'image/jpeg,image/png,application/pdf',
  },
  {
    id: 'photo',
    label: "Child's photo",
    hint: 'Recent passport-style photo · JPG, up to 5 MB',
    required: true,
    accept: 'image/jpeg,image/png',
  },
] as const;

function Stepper({ step }: { step: Step }): JSX.Element {
  const steps: { id: Step; label: string }[] = [
    { id: 'personal', label: 'Personal' },
    { id: 'documents', label: 'Documents' },
    { id: 'review', label: 'Review' },
  ];
  const idx = steps.findIndex((s) => s.id === step);

  return (
    <div
      className="mb-6 flex items-center justify-center gap-2"
      aria-label="Application progress"
    >
      {steps.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={s.id} className="flex items-center gap-2">
            {i > 0 ? (
              <span
                className={`h-0.5 w-8 sm:w-12 ${done || active ? 'bg-[var(--color-primary-500)]' : 'bg-border'}`}
              />
            ) : null}
            <div
              className={`flex items-center gap-2 ${active ? 'text-[var(--color-primary-700)]' : done ? 'text-emerald-700' : 'text-muted-foreground'}`}
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                  active
                    ? 'bg-[var(--color-primary-600)] text-white'
                    : done
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200 text-slate-600'
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="hidden text-sm font-semibold sm:inline">
                {s.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function ApplyWizard(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>('personal');
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [declared, setDeclared] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Hydrate from sessionStorage + query params
  useEffect(() => {
    let next = { ...EMPTY };
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) next = { ...EMPTY, ...(JSON.parse(raw) as Draft) };
    } catch {
      // ignore
    }
    const schoolId = searchParams.get('school');
    const schoolName = searchParams.get('name');
    if (schoolId) {
      next.institutionId = schoolId;
      next.institutionName = schoolName ?? next.institutionName;
    }
    setDraft(next);
    setHydrated(true);
  }, [searchParams]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // quota
    }
  }, [draft, hydrated]);

  const patch = useCallback((partial: Partial<Draft>) => {
    setDraft((prev) => ({ ...prev, ...partial }));
  }, []);

  const validatePersonal = useCallback((): boolean => {
    const next: Record<string, string> = {};
    if (!draft.firstName.trim()) next.firstName = 'First name is required';
    if (!draft.lastName.trim()) next.lastName = 'Last name is required';
    if (!draft.dateOfBirth) next.dateOfBirth = 'Date of birth is required';
    if (!draft.gender) next.gender = 'Gender is required';
    if (!draft.guardianName.trim()) next.guardianName = 'Guardian name is required';
    if (!draft.guardianPhone.trim()) next.guardianPhone = 'Mobile number is required';
    if (!draft.institutionId.trim()) {
      next.institutionId = 'Select a school before continuing';
    }
    if (
      draft.guardianEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.guardianEmail)
    ) {
      next.guardianEmail = 'Enter a valid email or leave blank';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }, [draft]);

  const requiredDocsOk = useMemo(() => {
    const have = new Set(draft.documents.map((d) => d.documentType));
    return DOC_TYPES.filter((d) => d.required).every((d) => have.has(d.id));
  }, [draft.documents]);

  async function handleFile(
    documentType: string,
    file: File | null,
  ): Promise<void> {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setErrors((e) => ({
        ...e,
        [documentType]: 'File must be 5 MB or smaller',
      }));
      return;
    }
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? '');
        const base64 = result.includes(',') ? result.split(',')[1]! : result;
        resolve(base64);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const meta: DocumentUploadMetadata = {
      fileName: file.name,
      fileType: file.type || 'application/octet-stream',
      fileSize: file.size,
      documentType,
      content,
    };
    setDraft((prev) => ({
      ...prev,
      documents: [
        ...prev.documents.filter((d) => d.documentType !== documentType),
        meta,
      ],
    }));
    setErrors((e) => {
      const { [documentType]: _, ...rest } = e;
      return rest;
    });
  }

  async function handleSubmit(): Promise<void> {
    if (!declared) {
      setSubmitError('Please confirm the declaration before submitting.');
      return;
    }
    if (!draft.institutionId) {
      setSubmitError('A target school is required. Pick one from Find Schools.');
      return;
    }
    if (!draft.gender) {
      setSubmitError('Gender is required.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    const result = await submitRegistration({
      institutionId: draft.institutionId,
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      dateOfBirth: draft.dateOfBirth,
      gender: draft.gender,
      guardianName: draft.guardianName.trim(),
      guardianPhone: draft.guardianPhone.trim(),
      ...(draft.guardianEmail.trim()
        ? { guardianEmail: draft.guardianEmail.trim() }
        : {}),
      customFields: [
        { fieldId: 'gradeApplying', value: draft.gradeApplying },
        { fieldId: 'homeAddress', value: draft.address },
      ],
      documents: draft.documents.map(({ content: _c, ...rest }) =>
        // Prefer metadata-only to keep the payload small; include content when small.
        rest.fileSize <= 512 * 1024 && _c
          ? { ...rest, content: _c }
          : rest,
      ),
      preferredLanguage: 'en',
    });

    setSubmitting(false);

    if (result.kind === 'error') {
      setSubmitError(
        result.message ||
          'We could not submit your application. Please try again shortly.',
      );
      return;
    }

    try {
      sessionStorage.setItem(TRACKING_KEY, result.data.trackingNumber);
      sessionStorage.setItem(
        'registration:lastApplicant',
        `${draft.firstName} ${draft.lastName}`.trim(),
      );
      sessionStorage.setItem(
        'registration:lastSchool',
        draft.institutionName || draft.institutionId,
      );
      sessionStorage.setItem(
        'registration:lastPhone',
        draft.guardianPhone,
      );
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }

    router.push(
      `/register/success?ref=${encodeURIComponent(result.data.trackingNumber)}`,
    );
  }

  if (!hydrated) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-9 sm:px-6 pb-14">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-extrabold tracking-tight">
          {step === 'personal'
            ? 'Student registration'
            : step === 'documents'
              ? 'Upload documents'
              : 'Review and submit'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {draft.institutionName
            ? `Applying to ${draft.institutionName} · Academic year 2026–27`
            : 'Academic year 2026–27'}
        </p>
      </div>

      <Stepper step={step} />

      {step === 'personal' ? (
        <form
          className="overflow-hidden rounded-xl border border-border bg-white shadow-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (validatePersonal()) setStep('documents');
          }}
        >
          <div className="border-b border-border px-5 py-4">
            <h3 className="font-bold">Personal information</h3>
            <p className="text-sm text-muted-foreground">
              Fill in your child&apos;s details exactly as on the birth certificate.
            </p>
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            {!draft.institutionId ? (
              <div className="sm:col-span-2">
                <Alert variant="warning">
                  <AlertDescription>
                    No school selected.{' '}
                    <Link
                      href="/register/schools"
                      className="font-semibold underline-offset-2 hover:underline"
                    >
                      Find a school
                    </Link>{' '}
                    first, or paste an institution ID below.
                  </AlertDescription>
                </Alert>
                <div className="mt-3 space-y-1.5">
                  <Label htmlFor="institutionId">Institution ID</Label>
                  <Input
                    id="institutionId"
                    value={draft.institutionId}
                    onChange={(e) => patch({ institutionId: e.target.value })}
                    placeholder="xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx"
                    aria-invalid={!!errors.institutionId}
                  />
                  {errors.institutionId ? (
                    <p className="text-sm text-destructive">{errors.institutionId}</p>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="sm:col-span-2 flex items-center justify-between rounded-lg border border-border bg-slate-50 px-4 py-3 text-sm">
                <span>
                  <b>{draft.institutionName || 'Selected school'}</b>
                  <span className="ms-2 font-mono text-xs text-muted-foreground">
                    {draft.institutionId}
                  </span>
                </span>
                <Link
                  href="/register/schools"
                  className="font-semibold text-[var(--color-primary-600)]"
                >
                  Change
                </Link>
              </div>
            )}

            <p className="sm:col-span-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Child&apos;s details
            </p>
            <Field
              label="First name"
              htmlFor="fname"
              error={errors.firstName}
              required
            >
              <Input
                id="fname"
                value={draft.firstName}
                onChange={(e) => patch({ firstName: e.target.value })}
                autoComplete="given-name"
              />
            </Field>
            <Field
              label="Last name"
              htmlFor="lname"
              error={errors.lastName}
              required
            >
              <Input
                id="lname"
                value={draft.lastName}
                onChange={(e) => patch({ lastName: e.target.value })}
                autoComplete="family-name"
              />
            </Field>
            <Field
              label="Date of birth"
              htmlFor="dob"
              error={errors.dateOfBirth}
              required
              hint="As written on the birth certificate"
            >
              <Input
                id="dob"
                type="date"
                value={draft.dateOfBirth}
                onChange={(e) => patch({ dateOfBirth: e.target.value })}
              />
            </Field>
            <Field label="Gender" htmlFor="gender" error={errors.gender} required>
              <select
                id="gender"
                className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                value={draft.gender}
                onChange={(e) =>
                  patch({
                    gender: e.target.value as Draft['gender'],
                  })
                }
              >
                <option value="">Select…</option>
                <option value="female">Girl</option>
                <option value="male">Boy</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field
              label="Class applying for"
              htmlFor="grade"
              className="sm:col-span-2"
              hint="Children completing 6 years by 1 Sep 2026 can join Class 1"
            >
              <select
                id="grade"
                className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                value={draft.gradeApplying}
                onChange={(e) => patch({ gradeApplying: e.target.value })}
              >
                {Array.from({ length: 8 }, (_, i) => (
                  <option key={i + 1} value={`Class ${i + 1}`}>
                    Class {i + 1}
                  </option>
                ))}
              </select>
            </Field>

            <p className="sm:col-span-2 mt-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Parent / guardian details
            </p>
            <Field
              label="Guardian's full name"
              htmlFor="gname"
              error={errors.guardianName}
              required
            >
              <Input
                id="gname"
                value={draft.guardianName}
                onChange={(e) => patch({ guardianName: e.target.value })}
                autoComplete="name"
              />
            </Field>
            <Field
              label="Mobile number"
              htmlFor="gphone"
              error={errors.guardianPhone}
              required
              hint="We send all updates by SMS to this number"
            >
              <Input
                id="gphone"
                type="tel"
                inputMode="numeric"
                value={draft.guardianPhone}
                onChange={(e) => patch({ guardianPhone: e.target.value })}
                autoComplete="tel-national"
              />
            </Field>
            <Field
              label="Email (optional)"
              htmlFor="gemail"
              error={errors.guardianEmail}
              className="sm:col-span-2"
            >
              <Input
                id="gemail"
                type="email"
                value={draft.guardianEmail}
                onChange={(e) => patch({ guardianEmail: e.target.value })}
                placeholder="name@example.com"
                autoComplete="email"
              />
            </Field>
            <Field
              label="Home address"
              htmlFor="addr"
              className="sm:col-span-2"
              hint="Used to confirm neighbourhood school priority"
            >
              <textarea
                id="addr"
                rows={3}
                className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                value={draft.address}
                onChange={(e) => patch({ address: e.target.value })}
                autoComplete="street-address"
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-4">
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Your data is protected and shared only with the school you apply to.
            </span>
            <Button type="submit" className="ms-auto">
              Next: Documents
              <ArrowRight className="ms-2 h-4 w-4" />
            </Button>
          </div>
        </form>
      ) : null}

      {step === 'documents' ? (
        <div>
          <p className="mb-4 text-center text-sm text-muted-foreground">
            Clear phone-camera photos are fine. Each file can be PDF or JPG, up
            to 5 MB.
          </p>
          <div className="space-y-3.5">
            {DOC_TYPES.map((doc) => {
              const uploaded = draft.documents.find(
                (d) => d.documentType === doc.id,
              );
              return (
                <div
                  key={doc.id}
                  className="rounded-xl border border-border bg-white p-5 shadow-sm"
                >
                  <div className="flex gap-3.5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-[var(--color-primary-50)] text-[var(--color-primary-600)]">
                      <FileText className="h-[18px] w-[18px]" />
                    </span>
                    <div>
                      <h3 className="flex flex-wrap items-center gap-2 text-base font-bold">
                        {doc.label}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            doc.required
                              ? 'bg-red-50 text-red-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {doc.required ? 'Required' : 'Optional'}
                        </span>
                      </h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {doc.hint}
                      </p>
                    </div>
                  </div>

                  {uploaded ? (
                    <div className="mt-3.5 flex items-center gap-2.5 rounded-md border border-emerald-300/40 bg-emerald-50 px-3.5 py-2.5">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {uploaded.fileName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatBytes(uploaded.fileSize)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
                        <Check className="h-3.5 w-3.5" />
                        Uploaded
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${doc.label}`}
                        className="rounded p-1 text-muted-foreground hover:bg-white hover:text-red-600"
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            documents: prev.documents.filter(
                              (d) => d.documentType !== doc.id,
                            ),
                          }))
                        }
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <label className="mt-3.5 flex cursor-pointer flex-col items-center gap-1.5 rounded-md border-2 border-dashed border-border px-4 py-6 text-center transition-colors hover:border-[var(--color-primary-400)] hover:bg-[var(--color-primary-50)]">
                      <Upload className="h-5 w-5 text-muted-foreground" />
                      <b className="text-sm">
                        Drag a file here or{' '}
                        <u className="text-[var(--color-primary-600)]">browse</u>
                      </b>
                      <span className="text-xs text-muted-foreground">
                        Up to 5 MB
                      </span>
                      <input
                        type="file"
                        accept={doc.accept}
                        className="sr-only"
                        onChange={(e) => {
                          void handleFile(
                            doc.id,
                            e.target.files?.[0] ?? null,
                          );
                        }}
                      />
                    </label>
                  )}
                  {errors[doc.id] ? (
                    <p className="mt-2 text-sm text-destructive">{errors[doc.id]}</p>
                  ) : null}
                </div>
              );
            })}
          </div>

          {!requiredDocsOk ? (
            <p className="mt-3 text-sm text-amber-700">
              Required documents can be skipped for now — the school may ask for
              them later. You can continue to review.
            </p>
          ) : null}

          <div className="mt-5 flex gap-2.5">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep('personal')}
            >
              <ArrowLeft className="me-2 h-4 w-4" />
              Back
            </Button>
            <Button
              type="button"
              className="ms-auto"
              onClick={() => setStep('review')}
            >
              Next: Review
              <ArrowRight className="ms-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {step === 'review' ? (
        <div className="space-y-3.5">
          <ReviewCard
            title="School selected"
            editHref="/register/schools"
            editLabel="Change"
          >
            <p className="font-semibold">
              {draft.institutionName || 'Institution'}
            </p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {draft.institutionId}
            </p>
          </ReviewCard>

          <ReviewCard
            title="Personal information"
            onEdit={() => setStep('personal')}
          >
            <dl className="grid gap-2 text-sm sm:grid-cols-[140px_1fr]">
              <dt className="text-muted-foreground">Child&apos;s name</dt>
              <dd>
                {draft.firstName} {draft.lastName}
              </dd>
              <dt className="text-muted-foreground">Date of birth</dt>
              <dd>{draft.dateOfBirth}</dd>
              <dt className="text-muted-foreground">Gender</dt>
              <dd className="capitalize">{draft.gender || '—'}</dd>
              <dt className="text-muted-foreground">Class</dt>
              <dd>{draft.gradeApplying}</dd>
              <dt className="text-muted-foreground">Guardian</dt>
              <dd>{draft.guardianName}</dd>
              <dt className="text-muted-foreground">Mobile</dt>
              <dd>{draft.guardianPhone}</dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd>{draft.guardianEmail || 'Not provided'}</dd>
              <dt className="text-muted-foreground">Address</dt>
              <dd>{draft.address || '—'}</dd>
            </dl>
          </ReviewCard>

          <ReviewCard
            title="Documents"
            onEdit={() => setStep('documents')}
          >
            <ul className="space-y-2">
              {DOC_TYPES.map((doc) => {
                const uploaded = draft.documents.find(
                  (d) => d.documentType === doc.id,
                );
                return (
                  <li
                    key={doc.id}
                    className="flex items-center gap-2.5 border-b border-dashed border-border py-2.5 last:border-0 last:pb-0 first:pt-0 text-sm"
                  >
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <b className="block font-semibold">{doc.label}</b>
                      <span className="text-xs text-muted-foreground">
                        {uploaded
                          ? `${uploaded.fileName} · ${formatBytes(uploaded.fileSize)}`
                          : doc.required
                            ? 'Not uploaded'
                            : 'Optional — can be added later'}
                      </span>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        uploaded
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {uploaded ? 'Uploaded' : 'Not added'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </ReviewCard>

          <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <label className="flex items-start gap-3 text-sm leading-relaxed">
              <Checkbox
                checked={declared}
                onCheckedChange={(v) => setDeclared(v === true)}
                className="mt-0.5"
              />
              <span>
                I, <strong>{draft.guardianName || 'the guardian'}</strong>,
                declare that the information given above is true to the best of
                my knowledge. I understand that the school may ask to see
                original documents at admission, and that providing false
                information may lead to cancellation of the application.
              </span>
            </label>
          </div>

          {submitError ? (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex gap-2.5">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep('documents')}
              disabled={submitting}
            >
              <ArrowLeft className="me-2 h-4 w-4" />
              Back
            </Button>
            <Button
              type="button"
              size="lg"
              className="ms-auto"
              disabled={submitting}
              onClick={() => {
                void handleSubmit();
              }}
            >
              {submitting ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="me-2 h-4 w-4" />
              )}
              Submit application
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  error,
  required,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="ms-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      <div className="mt-1.5">{children}</div>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
      {error ? (
        <p className="mt-1 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ReviewCard({
  title,
  editHref,
  editLabel = 'Edit',
  onEdit,
  children,
}: {
  title: string;
  editHref?: string;
  editLabel?: string;
  onEdit?: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
      <div className="flex items-center border-b border-border px-5 py-3">
        <h3 className="font-bold">{title}</h3>
        {editHref ? (
          <Link
            href={editHref}
            className="ms-auto text-sm font-semibold text-[var(--color-primary-600)]"
          >
            {editLabel}
          </Link>
        ) : onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="ms-auto text-sm font-semibold text-[var(--color-primary-600)]"
          >
            {editLabel}
          </button>
        ) : null}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}
