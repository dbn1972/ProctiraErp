/**
 * W1-SEC-02 (D2) — shared health route deny surface for App Router guards.
 */
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';

import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';

/** Copy matched by `09-route-permission-coupling` negative personas. */
export const HEALTH_ACCESS_DENIED_TITLE = 'Access denied';

interface HealthAccessDeniedProps {
  description: string;
}

export function HealthAccessDenied({ description }: HealthAccessDeniedProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-3 space-y-0">
        <div className="rounded-lg bg-destructive/10 p-2 text-destructive">
          <ShieldAlert className="h-6 w-6" aria-hidden="true" />
        </div>
        <div>
          <CardTitle className="text-base">{HEALTH_ACCESS_DENIED_TITLE}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <div className="px-6 pb-6">
        <Button asChild variant="outline">
          <Link href="/">Return to dashboard</Link>
        </Button>
      </div>
    </Card>
  );
}

export function PhiAccessDenied() {
  return (
    <HealthAccessDenied description="PHI access logs require a health admin or health officer role. Your session is not authorized to view this audit trail." />
  );
}
