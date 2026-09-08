/**
 * Institution edit form page (Server Component shell).
 *
 * Loads the existing institution and lookup catalogues, then defers to the
 * shared `InstitutionForm` Client Component to handle validation and
 * submission via a Server Action.
 */
import { notFound } from 'next/navigation';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { InstitutionForm } from '@/components/institutions/institution-form';
import { ApiClientError, getInstitution } from '@/lib/institutions/api';
import { loadInstitutionFormLookups } from '@/lib/institutions/lookups';

interface EditInstitutionPageProps {
  params: { id: string };
}

/**
 * Edit institution form (Server Component shell) — v2.0 redesign.
 *
 * Sits under the institution detail layout, so the shared hero + tab nav
 * provide the "which school" context. This page renders only a focused,
 * max-width edit form below that shell.
 */
export default async function EditInstitutionPage({ params }: EditInstitutionPageProps) {
  const [institution, lookups] = await Promise.all([
    loadInstitutionOrNotFound(params.id),
    loadInstitutionFormLookups(),
  ]);

  return (
    <Card className="max-w-[860px]">
      <CardHeader>
        <CardTitle className="text-base">Edit institution profile</CardTitle>
        <CardDescription>
          Update identity, location, classification, and contact details. Changes are recorded in
          the audit trail. Fields marked * are required.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <InstitutionForm
          initialValue={institution}
          areas={lookups.areas}
          types={lookups.types}
          sectors={lookups.sectors}
          ownerships={lookups.ownerships}
        />
      </CardContent>
    </Card>
  );
}

async function loadInstitutionOrNotFound(id: string) {
  try {
    return await getInstitution(id);
  } catch (error) {
    if (error instanceof ApiClientError && error.statusCode === 404) {
      notFound();
    }
    throw error;
  }
}
