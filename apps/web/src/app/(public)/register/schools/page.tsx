import { DocumentTitle } from '@/components/DocumentTitle';
import { listRegistrationInstitutions } from '@/lib/api/registration.server';
import type { InstitutionLocation } from '@/lib/api/registration';

import { SchoolsFinder } from './schools-finder';

/**
 * School finder — redesign/registration/schools.html.
 * Loads institutions via gateway; shows empty/error states when unavailable.
 */
export default async function RegisterSchoolsPage(): Promise<JSX.Element> {
  const result = await listRegistrationInstitutions({ pageSize: 50 });
  const schools: InstitutionLocation[] =
    result.kind === 'ok' ? result.data.data : [];
  const errorMessage = result.kind === 'error' ? result.message : null;

  return (
    <main className="mx-auto w-full max-w-[880px] px-4 py-9 sm:px-6 sm:py-9 pb-14">
      <DocumentTitle pageTitle="Find Schools" />
      <h1 className="text-3xl font-extrabold tracking-tight">
        Find a school near you
      </h1>
      <p className="mt-2 text-base text-muted-foreground">
        Search by school name or area. Pick a school when you register — you can
        change it before submitting.
      </p>

      <SchoolsFinder initialSchools={schools} initialError={errorMessage} />
    </main>
  );
}
