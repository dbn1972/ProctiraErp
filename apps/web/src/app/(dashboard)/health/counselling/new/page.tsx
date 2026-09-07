/**
 * Create counselling session — access-controlled write path.
 *
 * Posts to existing health domain API:
 *   POST /api/v1/health/counselling/sessions
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { canAccessHealthRecords } from '@/lib/api/health';

import { CreateCounsellingSessionForm } from '../../_components/create-counselling-session-form';

export const dynamic = 'force-dynamic';

export default async function NewCounsellingSessionPage() {
  const session = await requireSession('/health/counselling/new');

  if (!canAccessHealthRecords(session.user.roles)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Access denied</CardTitle>
          <CardDescription>
            Your role does not have permission to schedule counselling sessions.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <section aria-labelledby="schedule-counselling-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/health/counselling">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to counselling
        </Link>
      </Button>

      <div>
        <h1
          id="schedule-counselling-heading"
          className="text-3xl font-extrabold tracking-tight text-foreground"
        >
          Schedule counselling session
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a confidential session record. Writes go to the health counselling API when
          the gateway is available.
        </p>
      </div>

      <CreateCounsellingSessionForm />
    </section>
  );
}
