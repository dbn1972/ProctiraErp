/**
 * Institution edit form page (Server Component shell).
 *
 * Loads the existing institution and lookup catalogues, then defers to the
 * shared `InstitutionForm` Client Component to handle validation and
 * submission via a Server Action.
 */
import { notFound } from 'next/navigation';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { InstitutionForm } from '@/components/institutions/institution-form';
import { ApiClientError, getInstitution } from '@/lib/institutions/api';
import { loadInstitutionFormLookups } from '@/lib/institutions/lookups';

interface EditInstitutionPageProps {
  params: { id: string };
}

export default async function EditInstitutionPage({ params }: EditInstitutionPageProps) {
  const [institution, lookups] = await Promise.all([
    loadInstitutionOrNotFound(params.id),
    loadInstitutionFormLookups(),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Edit institution</h1>
        <p className="text-sm text-muted-foreground">
          Update the institution profile, classification, and contact details.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{institution.name}</CardTitle>
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
    </div>
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
