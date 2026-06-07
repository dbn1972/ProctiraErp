/**
 * Create scholarship program form.
 *
 * Validates: Requirement 11.1 — define scholarship programs with award
 * amount, slots, and application window.
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
  Textarea,
} from '@proctira/ui/components';

export default function NewScholarshipProgramPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">New scholarship program</h1>
        <p className="text-sm text-muted-foreground">
          Define eligibility, award amount, and the application window.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Program details</CardTitle>
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
              <Button type="submit">Create program</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
