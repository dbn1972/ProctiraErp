/**
 * Create scholarship program form.
 *
 * Validates: Requirement 11.1 — define scholarship programs with award
 * amount, slots, and application window.
 */
import Link from 'next/link';
import { ArrowLeft, Check } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  Textarea,
} from '@proctira/ui/components';

export default function NewScholarshipProgramPage() {
  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/scholarships">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to programs
        </Link>
      </Button>

      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
          New scholarship program
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Define the award, eligibility rules, and application window. Eligibility checks run
          automatically against student records when applications come in.
        </p>
      </div>

      <Card className="max-w-[860px]">
        <CardHeader>
          <CardTitle className="text-base">Program details</CardTitle>
          <CardDescription>
            Set the award amount, eligibility, and the application window.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" noValidate>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField id="program-name" label="Name" required>
                <Input id="program-name" name="name" placeholder="Academic Excellence Award" />
              </FormField>
              <FormField id="program-code" label="Code" required>
                <Input id="program-code" name="code" placeholder="AEA-2025" />
              </FormField>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <FormField id="program-slots" label="Total slots" required>
                <Input id="program-slots" name="totalSlots" type="number" min="1" />
              </FormField>
              <FormField id="program-amount" label="Award amount" required>
                <Input id="program-amount" name="awardAmount" type="number" step="0.01" />
              </FormField>
              <FormField id="program-currency" label="Currency" required>
                <Input id="program-currency" name="currency" placeholder="USD" maxLength={3} />
              </FormField>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField id="program-app-start" label="Application opens" required>
                <Input id="program-app-start" name="applicationStartDate" type="date" />
              </FormField>
              <FormField id="program-app-end" label="Application closes" required>
                <Input id="program-app-end" name="applicationEndDate" type="date" />
              </FormField>
            </div>
            <FormField id="program-eligibility" label="Eligibility criteria">
              <Textarea
                id="program-eligibility"
                name="eligibility"
                rows={4}
                placeholder="Describe academic, demographic, or financial criteria…"
              />
            </FormField>

            <div className="flex justify-end gap-3 pt-2">
              <Button asChild variant="outline" type="button">
                <Link href="/scholarships">Cancel</Link>
              </Button>
              <Button type="submit">
                <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
                Create program
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
