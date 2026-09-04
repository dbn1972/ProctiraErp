/**
 * Create workflow definition.
 *
 * Layout per redesign/web/workflows-definition-new.html.
 *
 * Validates: Requirement 13.1 — define multi-step approval workflow.
 * ProctiraERP — posts to POST /workflows via createWorkflowDefinitionAction.
 */
'use client';

import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';
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

import {
  createWorkflowDefinitionAction,
  type ActionState,
} from '../../actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Creating…' : 'Create definition'}
    </Button>
  );
}

export default function NewWorkflowDefinitionPage() {
  const [state, formAction] = useFormState<
    ActionState<{ definitionId: string }> | null,
    FormData
  >(createWorkflowDefinitionAction, null);

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
          <form action={formAction} className="space-y-5" noValidate>
            {state?.status === 'error' ? (
              <p
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {state.message}
              </p>
            ) : null}

            <FormField
              id="wf-name"
              label="Workflow name"
              required
              error={state?.fieldErrors?.name}
            >
              <Input
                id="wf-name"
                name="name"
                placeholder="Student transfer approval"
                required
              />
            </FormField>
            <FormField
              id="wf-module"
              label="Module / entity type"
              required
              error={state?.fieldErrors?.module}
              hint="e.g. student_transfer, staff_leave"
            >
              <Input
                id="wf-module"
                name="module"
                placeholder="student_transfer"
                required
              />
            </FormField>
            <FormField id="wf-desc" label="Description">
              <Textarea
                id="wf-desc"
                name="description"
                rows={2}
                placeholder="What this workflow approves…"
              />
            </FormField>
            <FormField
              id="wf-steps"
              label="Steps"
              required
              error={state?.fieldErrors?.steps}
              hint="One step per line: stepName,roleName"
            >
              <Textarea
                id="wf-steps"
                name="steps"
                rows={6}
                required
                placeholder={
                  'Headmaster review,Headmaster\nDistrict approval,District Administrator'
                }
              />
            </FormField>

            <div className="flex justify-end gap-3 pt-2">
              <Button asChild variant="outline" type="button">
                <Link href="/workflows">Cancel</Link>
              </Button>
              <SubmitButton />
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
