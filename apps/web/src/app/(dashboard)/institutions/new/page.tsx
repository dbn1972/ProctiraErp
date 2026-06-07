/**
 * Institution create form page (Server Component shell) — v2.0 redesign.
 *
 * Loads lookup options server-side and renders the client-side form.
 * Form submission is performed via a Server Action.
 *
 * v2.0 changes:
 * - text-3xl font-extrabold heading "Register institution"
 * - Subtitle: UDISE identity, location, administration note
 * - "Back to list" ghost button in page-head actions
 * - max-w-[860px] Card + InstitutionForm kept 100% intact
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
import { InstitutionForm } from '@/components/institutions/institution-form';
import { loadInstitutionFormLookups } from '@/lib/institutions/lookups';

export default async function NewInstitutionPage() {
  const lookups = await loadInstitutionFormLookups();

  return (
    <section aria-labelledby="register-institution-heading" className="space-y-6">

      {/* ── Page head ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="register-institution-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Register institution
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a new school profile with its UDISE identity, location, and
            administration details. It will appear on the district roster once
            approved.
          </p>
        </div>
        <div className="shrink-0">
          <Button asChild variant="ghost" size="sm">
            <Link href="/institutions">
              <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
              Back to list
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Form card ── */}
      <Card className="max-w-[860px]">
        <CardHeader>
          <CardTitle className="text-base">Institution profile</CardTitle>
          <CardDescription>
            Identity, location, classification, and contact details. Fields marked
            * are required.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InstitutionForm
            areas={lookups.areas}
            types={lookups.types}
            sectors={lookups.sectors}
            ownerships={lookups.ownerships}
          />
        </CardContent>
      </Card>
    </section>
  );
}
