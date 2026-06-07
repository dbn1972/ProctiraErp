/**
 * Institution create form page (Server Component shell).
 *
 * Loads lookup options server-side and renders the client-side form.
 * Form submission is performed via a Server Action.
 */
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { InstitutionForm } from '@/components/institutions/institution-form';
import { loadInstitutionFormLookups } from '@/lib/institutions/lookups';

export default async function NewInstitutionPage() {
  const lookups = await loadInstitutionFormLookups();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Create institution</h1>
        <p className="text-sm text-muted-foreground">
          Provide the institution profile, classification, and contact details.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Institution profile</CardTitle>
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
    </div>
  );
}
