import Link from 'next/link';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * /forbidden — shown when an operator's role is not allowed in the requested
 * area. The audit log records the redirect.
 */
export default function ForbiddenPage({
  searchParams,
}: {
  searchParams: { area?: string };
}) {
  const area = searchParams?.area ?? 'this area';
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md space-y-4">
        <Alert variant="destructive">
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>
            Your assigned platform role does not include access to{' '}
            <strong>{area}</strong>. If you believe this is incorrect, contact
            the security team.
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline" className="w-full">
          <Link href="/">Return to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
