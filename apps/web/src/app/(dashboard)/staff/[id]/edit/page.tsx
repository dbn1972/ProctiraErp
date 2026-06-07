/**
 * /staff/[id]/edit — Edit staff record (Server Component shell).
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { getStaff } from '@/lib/api/staff';
import type { StaffFormValues } from '@/lib/validation/staff-schema';

import { StaffForm } from '../../_components/staff-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

export default async function EditStaffPage({ params }: PageProps) {
  const staff = await getStaff(params.id);
  if (!staff) {
    notFound();
  }

  const initialValues: StaffFormValues = {
    firstName: staff.firstName,
    lastName: staff.lastName,
    dateOfBirth: staff.dateOfBirth,
    identityNumber: staff.identityNumber,
    contactPhone: staff.contactPhone,
    contactEmail: staff.contactEmail ?? '',
    position: staff.position,
  };

  return (
    <section aria-labelledby="edit-staff-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/staff/${staff.id}`}>
          <ArrowLeft className="me-2 h-4 w-4" aria-hidden="true" />
          Back to profile
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle id="edit-staff-heading">
            Edit {staff.firstName} {staff.lastName}
          </CardTitle>
          <CardDescription>Update identity and contact information.</CardDescription>
        </CardHeader>
        <CardContent>
          <StaffForm
            mode="edit"
            staffId={staff.id}
            initialValues={initialValues}
          />
        </CardContent>
      </Card>
    </section>
  );
}
