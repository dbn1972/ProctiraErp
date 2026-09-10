/**
 * /staff/new — Create staff record (Server Component shell) — v2.0 redesign.
 *
 * v2.0 changes:
 * - text-3xl font-extrabold heading "Add staff member"
 * - Subtitle explaining employee ID generation and BEO routing
 * - "Back to staff" in page-head actions
 * - StaffForm kept 100% intact
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
      {/* ── Page head ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="new-staff-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Add staff member
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a service record for a teaching or non-teaching staff member. An employee ID is
            generated on save and the record is routed to the BEO for verification.
          </p>
        </div>
        <div className="shrink-0">
          <Button asChild variant="ghost" size="sm">
            <Link href="/staff">
              <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
              Back to staff
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Form ── */}
      <Card className="max-w-[860px]">
        <CardHeader>
          <CardTitle className="text-base">Personal & employment details</CardTitle>
          <CardDescription>
            Fields marked * are required. Personal information, designation, school posting, and
            qualifications.
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
