/**
 * Institution edit form page (Server Component shell).
 *
 * Loads the existing institution and lookup catalogues, then defers to the
 * shared `InstitutionForm` Client Component to handle validation and
 * submission via a Server Action.
 */
export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { InstitutionForm } from '@/components/institutions/institution-form';
import { ApiClientError } from '@/lib/institutions/api';
import { classifyInstitutionLoadError } from '@/lib/institutions/load-state';
import { getCachedInstitution } from '@/lib/institutions/request-cache';
import { loadInstitutionFormLookups } from '@/lib/institutions/lookups';

interface EditInstitutionPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Edit institution form (Server Component shell) — v2.0 redesign.
 *
 * Sits under the institution detail layout, so the shared hero + tab nav
 * provide the "which school" context. This page renders only a focused,
 * max-width edit form below that shell.
 */
export default async function EditInstitutionPage(props: EditInstitutionPageProps) {
  const params = await props.params;
  const [institution, lookups] = await Promise.all([
    loadInstitutionOrNotFound(params.id),
    loadInstitutionFormLookups(),
  ]);
  if (!institution) return null;

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
    return await getCachedInstitution(id);
  } catch (error) {
    if (!(error instanceof ApiClientError)) throw error;
    const failure = classifyInstitutionLoadError(error);
    if (failure === 'not-found') notFound();
    if (failure === 'gateway-down') return null;
    throw error;
  }
}
