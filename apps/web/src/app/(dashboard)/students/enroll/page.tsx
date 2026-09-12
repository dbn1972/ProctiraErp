/**
 * /students/enroll — Enrollment progression hub (App Router).
 *
 * Federated `/app/students/enroll` redirects here. Primary CTA opens the real
 * add-student form; existing students enroll from their profile.
 */
import Link from 'next/link';
import { ArrowLeft, Upload, UserPlus, Users } from 'lucide-react';

import { Button } from '@proctira/ui/components';

export const dynamic = 'force-dynamic';

export default function StudentsEnrollHubPage() {
  return (
    <section
      aria-labelledby="enroll-hub-heading"
      className="space-y-6"
      data-testid="students-enroll-hub"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="enroll-hub-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Enrol student
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Capture a new student record, then place them in an institution and grade. Existing
            students enroll from their profile.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/students">
              <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
              Back to students
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">New student</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Demographics, guardians, and identity — then enroll from the profile.
          </p>
          <Button asChild className="mt-4" data-testid="enroll-hub-add-student">
            <Link href="/students/new">
              <UserPlus className="me-1.5 h-4 w-4" aria-hidden="true" />
              Add student
            </Link>
          </Button>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">Existing student</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a profile without an active enrollment and choose Enroll.
          </p>
          <Button asChild variant="outline" className="mt-4" data-testid="enroll-hub-directory">
            <Link href="/students">
              <Users className="me-1.5 h-4 w-4" aria-hidden="true" />
              Browse students
            </Link>
          </Button>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">Bulk import</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Import many records from a workbook when onboarding a cohort.
          </p>
          <Button asChild variant="outline" className="mt-4" data-testid="enroll-hub-import">
            <Link href="/students/import">
              <Upload className="me-1.5 h-4 w-4" aria-hidden="true" />
              Bulk import
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
