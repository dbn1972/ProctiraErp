'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import {
  getInstitutions,
  type InstitutionFilters,
  type InstitutionLocation,
} from '@/lib/api';

// Dynamically import the map component to avoid SSR issues with Leaflet
const MapView = dynamic(() => import('./map-view').then((mod) => mod.MapView), {
  ssr: false,
  loading: () => (
    <div className="flex h-[500px] items-center justify-center rounded-md bg-gray-100">
      <span className="text-sm text-gray-500">Loading map…</span>
    </div>
  ),
});

interface FilterOption {
  id: string;
  name: string;
}

interface InstitutionMapProps {
  /** Initial server-rendered list to avoid a flash of empty content */
  initialInstitutions?: InstitutionLocation[];
  /** Filter options derived from the initial server fetch */
  initialAreas?: FilterOption[];
  initialTypes?: FilterOption[];
  initialGrades?: FilterOption[];
}

/**
 * Interactive school-finder map with area / type / grade / search filters.
 *
 * Uses Leaflet (via react-leaflet) for the map. The initial data is rendered
 * server-side and refined on the client as the user changes filters.
 */
export function InstitutionMap({
  initialInstitutions = [],
  initialAreas = [],
  initialTypes = [],
  initialGrades = [],
}: InstitutionMapProps) {
  const t = useTranslations('institutions');
  const [institutions, setInstitutions] = useState<InstitutionLocation[]>(initialInstitutions);
  const [filters, setFilters] = useState<InstitutionFilters>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  // Re-fetch when filters change
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const result = await getInstitutions({ ...filters, pageSize: 200 });
        if (!cancelled) setInstitutions(result.data);
      } catch {
        if (!cancelled) setInstitutions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [filters]);

  // Client-side search filter
  const filteredInstitutions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return institutions;
    return institutions.filter(
      (inst) =>
        inst.name.toLowerCase().includes(query) ||
        inst.code.toLowerCase().includes(query) ||
        (inst.areaName?.toLowerCase().includes(query) ?? false),
    );
  }, [institutions, searchQuery]);

  function setFilter(key: keyof InstitutionFilters, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value || undefined }));
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="search" className="input-label">
              {t('searchPlaceholder')}
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute start-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                aria-hidden="true"
              />
              <input
                id="search"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="input-field ps-8"
              />
            </div>
          </div>

          <FilterSelect
            id="area-filter"
            label={t('filterByArea')}
            allLabel={t('allAreas')}
            value={filters.areaId ?? ''}
            options={initialAreas}
            onChange={(v) => setFilter('areaId', v)}
          />
          <FilterSelect
            id="type-filter"
            label={t('filterByType')}
            allLabel={t('allTypes')}
            value={filters.typeId ?? ''}
            options={initialTypes}
            onChange={(v) => setFilter('typeId', v)}
          />
          <FilterSelect
            id="grade-filter"
            label={t('filterByGrade')}
            allLabel={t('allGrades')}
            value={filters.gradeId ?? ''}
            options={initialGrades}
            onChange={(v) => setFilter('gradeId', v)}
          />
        </div>
        <p className="mt-4 text-xs text-gray-500">
          {t('resultsCount', { count: String(filteredInstitutions.length) })}
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 shadow-sm">
        <MapView institutions={filteredInstitutions} loading={loading} />
      </div>

      {filteredInstitutions.length === 0 && !loading && (
        <div className="card text-center text-sm text-gray-500">{t('noResults')}</div>
      )}

      {filteredInstitutions.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredInstitutions.map((institution) => (
            <li key={institution.id} className="card">
              <h3 className="font-semibold text-gray-900">{institution.name}</h3>
              <p className="mt-1 text-xs text-gray-500">{institution.code}</p>
              {institution.areaName && (
                <p className="mt-1 text-sm text-gray-600">{institution.areaName}</p>
              )}
              {institution.typeName && (
                <p className="text-sm text-gray-600">{institution.typeName}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface FilterSelectProps {
  id: string;
  label: string;
  allLabel: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}

function FilterSelect({ id, label, allLabel, value, options, onChange }: FilterSelectProps) {
  return (
    <div>
      <label htmlFor={id} className="input-label">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-field"
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </div>
  );
}
