/**
 * Create workflow definition.
 *
 * Validates: Requirement 13.1 — define multi-step approval workflow.
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  FormField,
  Input,
  Textarea,
} from '@proctira/ui/components';

export default function NewWorkflowDefinitionPage() {
  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/workflows">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Workflows
        </Link>
      </Button>

      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
          New workflow definition
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Define the approval chain once — every matching request is then routed
          step by step, with SLA tracking and escalation built in.
        </p>
      </div>

      <Card className="max-w-[860px]">
        <CardContent className="p-6">
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
    </div>
  );
}
