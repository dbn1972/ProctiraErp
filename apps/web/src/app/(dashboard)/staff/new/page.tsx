/**
 * /staff/new — Create staff record (Server Component shell).
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
} from '@proctira/ui/components';

import { StaffForm } from '../_components/staff-form';

export const dynamic = 'force-dynamic';

export default function NewStaffPage() {
  return (
    <section aria-labelledby="new-staff-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/staff">
          <ArrowLeft className="me-2 h-4 w-4" aria-hidden="true" />
          Back to staff
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle id="new-staff-heading">Add staff member</CardTitle>
          <CardDescription>
            Capture identity and contact information.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StaffForm
            mode="create"
            initialValues={{
              firstName: '',
              lastName: '',
              dateOfBirth: '',
              identityNumber: '',
              contactPhone: '',
              contactEmail: '',
              position: '',
            }}
          />
        </CardContent>
      </Card>
    </section>
  );
}
