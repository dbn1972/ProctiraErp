/**
 * Create workflow definition.
 *
 * Layout per redesign/web/workflows-definition-new.html.
 *
 * Validates: Requirement 13.1 — define multi-step approval workflow.
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
  Textarea,
} from '@proctira/ui/components';

export const dynamic = 'force-dynamic';

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
        <CardHeader>
          <CardTitle className="text-base">Definition</CardTitle>
          <CardDescription>
            Name the flow, pick a module, then list approval steps in order.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" noValidate>
            <FormField id="wf-name" label="Workflow name" required>
              <Input
                id="wf-name"
                name="name"
                placeholder="Student transfer approval"
              />
            </FormField>
            <FormField id="wf-module" label="Module" required>
              <Input id="wf-module" name="module" placeholder="Students" />
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
                placeholder={
                  'Headmaster review,Headmaster\nDistrict approval,District Administrator'
                }
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
