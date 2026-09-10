/**
 * Bulk staff CSV import (G-918).
 */
import Link from 'next/link';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';

import { StaffImportForm } from '../_components/staff-import-form';

export const dynamic = 'force-dynamic';

export default async function StaffImportPage() {
  await requireSession();

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Bulk staff import
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dry-run validates every row, then commit creates staff (and optional contracts).
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/staff">Back to staff</Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">CSV upload</CardTitle>
          <CardDescription>
            Required columns: firstName, lastName, dateOfBirth, identityNumber, contactPhone,
            position.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StaffImportForm />
        </CardContent>
      </Card>
    </div>
  );
}
