/**
 * New examination form page.
 *
 * Validates: Requirement 10.1 — define examination cycles with code, date,
 * and registration window.
 */
import Link from 'next/link';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormField,
  Input,
} from '@proctira/ui/components';

export default function NewExaminationPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Create examination</h1>
        <p className="text-sm text-muted-foreground">
          Provide the examination definition: code, date, and registration window.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Examination details</CardTitle>
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
    </div>
  );
}
