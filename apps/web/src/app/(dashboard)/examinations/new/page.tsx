/**
 * New examination form page.
 *
 * Validates: Requirement 10.1 — define examination cycles with code, date,
 * and registration window.
 */
import Link from 'next/link';
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

export default function NewExaminationPage() {
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
          <form className="space-y-5" noValidate>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField id="exam-name" label="Name" required>
                <Input id="exam-name" name="name" placeholder="Final Year Examination" />
              </FormField>
              <FormField id="exam-code" label="Code" required>
                <Input id="exam-code" name="code" placeholder="FYE-2025" />
              </FormField>
            </div>
            <FormField id="exam-date" label="Examination date" required>
              <Input id="exam-date" name="examinationDate" type="date" />
            </FormField>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField id="reg-start" label="Registration opens">
                <Input id="reg-start" name="registrationStartDate" type="date" />
              </FormField>
              <FormField id="reg-end" label="Registration closes">
                <Input id="reg-end" name="registrationEndDate" type="date" />
              </FormField>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button asChild variant="outline" type="button">
                <Link href="/examinations">Cancel</Link>
              </Button>
              <Button type="submit">Create examination</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
