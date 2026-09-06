'use client';

import Link from 'next/link';
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
} from '@proctira/ui/components';

type FieldErrors = {
  name?: string;
  code?: string;
  examinationDate?: string;
};

/**
 * Client-validated examination create form.
 * Does not invent a successful backend create — submission acknowledges demo mode.
 */
export function NewExaminationForm() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [examinationDate, setExaminationDate] = useState('');
  const [registrationStartDate, setRegistrationStartDate] = useState('');
  const [registrationEndDate, setRegistrationEndDate] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [demoAck, setDemoAck] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!name.trim()) next.name = 'Name is required';
    if (!code.trim()) next.code = 'Code is required';
    if (!examinationDate) next.examinationDate = 'Examination date is required';
    return next;
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDemoAck(null);
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setDemoAck(
      'Demo validation passed — examination create is not connected to a live exams API in this build.',
    );
  }

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
          Define the examination cycle: name, code, date, and registration window.
        </p>
      </div>

      <Card className="max-w-[760px]">
        <CardHeader>
          <CardTitle className="text-base">Examination details</CardTitle>
          <CardDescription>Fields marked * are required.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-5"
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
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Final Year Examination"
                  aria-invalid={Boolean(errors.name)}
                />
              </FormField>
              <FormField id="exam-code" label="Code" required error={errors.code}>
                <Input
                  id="exam-code"
                  name="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="FYE-2025"
                  aria-invalid={Boolean(errors.code)}
                />
              </FormField>
            </div>
            <FormField
              id="exam-date"
              label="Examination date"
              required
              error={errors.examinationDate}
            >
              <Input
                id="exam-date"
                name="examinationDate"
                type="date"
                value={examinationDate}
                onChange={(e) => setExaminationDate(e.target.value)}
                aria-invalid={Boolean(errors.examinationDate)}
              />
            </FormField>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField id="reg-start" label="Registration opens">
                <Input
                  id="reg-start"
                  name="registrationStartDate"
                  type="date"
                  value={registrationStartDate}
                  onChange={(e) => setRegistrationStartDate(e.target.value)}
                />
              </FormField>
              <FormField id="reg-end" label="Registration closes">
                <Input
                  id="reg-end"
                  name="registrationEndDate"
                  type="date"
                  value={registrationEndDate}
                  onChange={(e) => setRegistrationEndDate(e.target.value)}
                />
              </FormField>
            </div>

            {demoAck ? (
              <p
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
                role="status"
                data-testid="examination-create-demo-ack"
              >
                {demoAck}
              </p>
            ) : null}

            <div className="flex justify-end gap-3 pt-2">
              <Button asChild variant="outline" type="button">
                <Link href="/examinations">Cancel</Link>
              </Button>
              <Button type="submit" data-testid="examination-create-submit">
                Create examination
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
