/**
 * Create workflow definition.
 *
 * Validates: Requirement 13.1 — define multi-step approval workflow.
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@proctira/ui/components';

import { NewDefinitionForm } from '../../_components/new-definition-form';

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
          Define the approval chain once — every matching request is then routed step by step, with
          SLA tracking and escalation built in.
        </p>
      </div>

      <NewDefinitionForm />
    </div>
  );
}
