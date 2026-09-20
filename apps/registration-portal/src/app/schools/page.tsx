import { getTranslations } from 'next-intl/server';

import { InstitutionMap } from '@/components/institutions/institution-map';
import { Footer } from '@/components/layout/footer';
import { Header } from '@/components/layout/header';
import { getInstitutions, type InstitutionFilters, type InstitutionLocation } from '@/lib/api';

export default async function SchoolsPage({
  searchParams,
}: {
  searchParams: Promise<{ typeId?: string | string[] }>;
}) {
  const t = await getTranslations('institutions');
  const query = await searchParams;
  const typeId = typeof query.typeId === 'string' ? query.typeId : undefined;
  const initialFilters: InstitutionFilters = typeId ? { typeId } : {};
  let institutions: InstitutionLocation[] = [];
  let initialError = false;
  try {
    const response = await getInstitutions({ ...initialFilters, pageSize: 200 });
    institutions = response.data;
  } catch {
    initialError = true;
  }

  const areasMap = new Map<string, string>();
  const typesMap = new Map<string, string>();
  const gradesSet = new Set<string>();
  for (const institution of institutions) {
    if (institution.areaName) areasMap.set(institution.areaId, institution.areaName);
    if (institution.typeName) typesMap.set(institution.typeId, institution.typeName);
    institution.availableGrades?.forEach((grade) => gradesSet.add(grade));
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">{t('title')}</h1>
            <p className="mt-2 text-sm text-gray-600">{t('subtitle')}</p>
          </div>
          <div className="mt-6">
            <InstitutionMap
              initialInstitutions={institutions}
              initialAreas={Array.from(areasMap, ([id, name]) => ({ id, name }))}
              initialTypes={Array.from(typesMap, ([id, name]) => ({ id, name }))}
              initialGrades={Array.from(gradesSet, (id) => ({ id, name: id }))}
              initialFilters={initialFilters}
              initialError={initialError}
            />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
