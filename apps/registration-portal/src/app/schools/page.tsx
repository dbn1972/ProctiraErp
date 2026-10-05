import { getTranslations } from 'next-intl/server';

import { InstitutionMap } from '@/components/institutions/institution-map';
import { Footer } from '@/components/layout/footer';
import { Header } from '@/components/layout/header';
import Link from 'next/link';
import {
  getInstitutionFilters,
  getInstitutions,
  type InstitutionFilterOptions,
  type InstitutionFilters,
  type InstitutionLocation,
} from '@/lib/api';
import { resolveTypeFilter } from '@/lib/institution-filters';
import { serverTransport } from '@/lib/gateway';
import { MAX_PUBLIC_PAGE_SIZE } from '@/lib/pagination';

export default async function SchoolsPage({
  searchParams,
}: {
  searchParams: Promise<{ typeId?: string | string[] }>;
}) {
  const t = await getTranslations('institutions');
  const query = await searchParams;
  const typeId = typeof query.typeId === 'string' ? query.typeId : undefined;
  // PRC-M051/M056: filter options come from the dedicated endpoint (all active
  // institutions), not from the first page of results.
  let options: InstitutionFilterOptions | null = null;
  try {
    options = await getInstitutionFilters(serverTransport);
  } catch {
    options = null;
  }
  const typeFilter = resolveTypeFilter(typeId, options);
  const initialFilters: InstitutionFilters = typeId && typeFilter !== 'invalid' ? { typeId } : {};
  let institutions: InstitutionLocation[] = [];
  let initialTotal = 0;
  let initialError = options === null;
  if (typeFilter !== 'invalid') {
    try {
      const response = await getInstitutions(
        { ...initialFilters, pageSize: MAX_PUBLIC_PAGE_SIZE },
        serverTransport,
      );
      institutions = response.data;
      initialTotal = response.meta.totalItems;
    } catch {
      initialError = true;
    }
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
            {typeFilter === 'invalid' ? (
              <div
                role="alert"
                className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
              >
                <p className="font-semibold">{t('invalidFilterTitle')}</p>
                <p className="mt-1">{t('invalidFilterMessage')}</p>
                <Link href="/schools" className="btn-secondary mt-3 inline-flex">
                  {t('showAll')}
                </Link>
              </div>
            ) : (
              <InstitutionMap
                initialInstitutions={institutions}
                initialTotal={initialTotal}
                initialAreas={options?.areas ?? []}
                initialTypes={options?.types ?? []}
                initialGrades={(options?.grades ?? []).map((id) => ({ id, name: id }))}
                initialFilters={initialFilters}
                initialError={initialError}
              />
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
