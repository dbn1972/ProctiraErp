/**
 * Create workflow definition.
 *
 * Validates: Requirement 13.1 — define multi-step approval workflow.
 */
import Link from 'next/link';

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

export default function NewWorkflowDefinitionPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">New workflow definition</h1>
        <p className="text-sm text-muted-foreground">
          Define the approval steps and roles required for this workflow.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Definition</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" noValidate>
            <FormField id="wf-name" label="Workflow name" required>
              <Input id="wf-name" name="name" placeholder="Student transfer approval" />
            </FormField>
            <FormField id="wf-module" label="Module" required>
              <Input id="wf-module" name="module" placeholder="student" />
            </FormField>
            <FormField
              id="wf-steps"
              label="Steps"
              required
              hint="One step per line: stepName,roleName"
            >
              <Textarea
                id="wf-steps"
                name="steps"
                rows={6}
                placeholder={'Principal review,PRINCIPAL\nDistrict approval,DISTRICT_ADMIN'}
              />
            </FormField>

            <div className="flex justify-end gap-3 pt-2">
              <Button asChild variant="outline" type="button">
                <Link href="/workflows">Cancel</Link>
              </Button>
              <Button type="submit">Create definition</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tips</CardTitle>
          <CardDescription>
            Steps execute in order. Each step requires approval from one of the
            mapped roles before the next step is activated.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
