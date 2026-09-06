/**
 * Create scholarship program form.
 *
 * Layout per redesign/web/scholarships-program-new.html:
 *  - Page head + program details form (name, code, slots, award, window)
 *
 * Validates: Requirement 11.1 — define scholarship programs with award
 * amount, slots, and application window.
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@proctira/ui/components';

import { NewProgramForm } from '../../_components/new-program-form';

export default function NewScholarshipProgramPage() {
  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/scholarships">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to programs
        </Link>
      </Button>

      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
          New scholarship program
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Define the award, eligibility rules, and application window. Eligibility checks run
          automatically against student records when applications come in.
        </p>
      </div>

      <NewProgramForm />
    </div>
  );
}
