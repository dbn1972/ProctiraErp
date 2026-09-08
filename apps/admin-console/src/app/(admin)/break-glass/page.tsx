import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StubDataBanner } from '@/components/stub-data-banner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth/server';
import { listBreakGlassRequests } from '@/lib/api/break-glass';

import { BreakGlassRequestForm } from './request-form';

/**
 * /break-glass — request elevated access to a tenant.
 *
 * Section 41 policy:
 *  - approved use cases only (catalogue selection)
 *  - approval chain required (separate /break-glass/requests view)
 *  - duration-limited (capped at 4 hours)
 *  - least-privilege scope (read / support / admin)
 *  - all transitions audited
 */
export default async function BreakGlassPage() {
  await requireRole('breakGlassRequest', '/break-glass');
  const { source } = await listBreakGlassRequests();

  return (
    <>
      <PageHeader
        title="Break-glass access"
        description="Request elevated access to a tenant for an approved use case."
        actions={
          <Button asChild variant="outline">
            <Link href="/break-glass/requests">Open queue</Link>
          </Button>
        }
      />

      <StubDataBanner
        source={source}
        detail="Break-glass create/approve APIs fall back to stub requests when the gateway is offline. Grants shown here are not live elevated sessions."
      />

      <Alert variant="warning" className="mb-6">
        <AlertTitle>Section 41 policy reminder</AlertTitle>
        <AlertDescription>
          Break-glass access is auditable and time-boxed. Every request must state an approved use
          case and be reviewed by security before any elevated session is opened. Maximum grant
          duration: 4 hours.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>New request</CardTitle>
          <CardDescription>
            Provide a detailed justification. Approvers will see your identity, the target tenant,
            the requested scope, and the use-case category.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BreakGlassRequestForm />
        </CardContent>
      </Card>
    </>
  );
}
