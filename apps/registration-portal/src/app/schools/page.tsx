import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { InstitutionMap } from '@/components/institutions/institution-map';
import { getInstitutions, type InstitutionLocation } from '@/lib/api';

/**
 * Public school finder page.
 *
 * Server-side fetches an initial page of institutions and derives filter
 * options (areas / types / grades) from that page; the client component
 * (`<InstitutionMap>`) refines via further requests as the user changes
 * filters. Falls back to an empty list if the backend is unavailable.
 */
export default async function SchoolsPage() {
  const t = await getTranslations('institutions');
  let institutions: InstitutionLocation[] = [];
  try {
    const response = await getInstitutions({ pageSize: 200 });
    institutions = response.data;
  } catch {
    institutions = [];
  }

  // Derive distinct filter options from the initial result set
  const areasMap = new Map<string, string>();
  const typesMap = new Map<string, string>();
  const gradesSet = new Set<string>();
  for (const inst of institutions) {
    if (inst.areaName) areasMap.set(inst.areaId, inst.areaName);
    if (inst.typeName) typesMap.set(inst.typeId, inst.typeName);
    inst.availableGrades?.forEach((g) => gradesSet.add(g));
  }
  const areas = Array.from(areasMap.entries()).map(([id, name]) => ({ id, name }));
  const types = Array.from(typesMap.entries()).map(([id, name]) => ({ id, name }));
  const grades = Array.from(gradesSet).map((id) => ({ id, name: id }));

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
              initialAreas={areas}
              initialTypes={types}
              initialGrades={grades}
            />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
