'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import {
  BookOpen,
  Building2,
  Loader2,
  MapPin,
  Search,
  Users,
} from 'lucide-react';

import {
  Alert,
  AlertDescription,
  Button,
  Input,
} from '@proctira/ui/components';
import {
  fetchRegistrationInstitutions,
  type InstitutionLocation,
} from '@/lib/api/registration';

export function SchoolsFinder({
  initialSchools,
  initialError,
}: {
  initialSchools: InstitutionLocation[];
  initialError: string | null;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [areaFilter, setAreaFilter] = useState('all');
  const [schools, setSchools] = useState(initialSchools);
  const [error, setError] = useState<string | null>(initialError);
  const [isPending, startTransition] = useTransition();

  const areas = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of schools) {
      if (s.areaName) map.set(s.areaId, s.areaName);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [schools]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return schools.filter((s) => {
      if (areaFilter !== 'all' && s.areaId !== areaFilter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        (s.areaName?.toLowerCase().includes(q) ?? false) ||
        (s.address?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [schools, query, areaFilter]);

  function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await fetchRegistrationInstitutions({
        search: query.trim() || undefined,
        areaId: areaFilter === 'all' ? undefined : areaFilter,
        pageSize: 50,
      });
      if (result.kind === 'ok') {
        setSchools(result.data.data);
        setError(null);
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div className="mt-5 space-y-4">
      <form
        onSubmit={handleSearch}
        className="grid gap-2.5 sm:grid-cols-[1fr_220px_auto]"
        role="search"
      >
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="School name or village"
            aria-label="Search schools"
            className="ps-9"
          />
        </div>
        <select
          aria-label="Filter by area"
          value={areaFilter}
          onChange={(e) => setAreaFilter(e.target.value)}
          className="h-10 rounded-md border border-input bg-white px-3 text-sm"
        >
          <option value="all">All areas</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <Loader2 className="me-2 h-4 w-4 animate-spin" />
          ) : (
            <Search className="me-2 h-4 w-4" />
          )}
          Search
        </Button>
      </form>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>
            Schools could not be loaded ({error}). You can still start an
            application and enter a school later, or retry the search.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2.5 text-sm text-muted-foreground">
        <strong className="text-foreground">
          {filtered.length} school{filtered.length === 1 ? '' : 's'} found
        </strong>
        {areaFilter !== 'all' ? (
          <span>
            in {areas.find((a) => a.id === areaFilter)?.name ?? 'selected area'}
          </span>
        ) : null}
      </div>

      {filtered.length === 0 && !error ? (
        <div className="rounded-xl border border-dashed border-border bg-white px-6 py-12 text-center">
          <Building2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="font-semibold">No schools match your search</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try a different name or clear the area filter. You can still{' '}
            <Link
              href="/register/apply"
              className="font-semibold text-[var(--color-primary-600)] underline-offset-2 hover:underline"
            >
              start registration
            </Link>{' '}
            without selecting a school from this list.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3.5">
          {filtered.map((school) => (
            <li
              key={school.id}
              className="flex flex-wrap gap-4 rounded-xl border border-border bg-white p-4 transition-shadow hover:border-[var(--color-primary-300)] hover:shadow-md sm:flex-nowrap sm:p-5"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-50)] text-[var(--color-primary-600)]">
                <Building2 className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold tracking-tight">{school.name}</h3>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{school.code}</span>
                  {school.areaName ? (
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                      {school.areaName}
                    </span>
                  ) : null}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-4 text-sm text-muted-foreground">
                  {school.address ? (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" />
                      {school.address}
                    </span>
                  ) : null}
                  {school.availableGrades && school.availableGrades.length > 0 ? (
                    <span className="inline-flex items-center gap-1.5">
                      <BookOpen className="h-3.5 w-3.5" />
                      Grades: {school.availableGrades.slice(0, 6).join(', ')}
                      {school.availableGrades.length > 6 ? '…' : ''}
                    </span>
                  ) : null}
                  {school.typeName ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" />
                      {school.typeName}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex w-full flex-row items-center justify-between gap-3 sm:w-auto sm:flex-col sm:items-end">
                <Link
                  href={`/register/apply?school=${encodeURIComponent(school.id)}&name=${encodeURIComponent(school.name)}`}
                  className="inline-flex h-10 flex-1 items-center justify-center rounded-md border border-border bg-white px-4 text-sm font-semibold transition-colors hover:bg-slate-50 sm:flex-none"
                >
                  Select this school
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Alert className="mt-5">
        <AlertDescription>
          <b>Tip:</b> Seat availability updates overnight. If a school is full,
          you can still apply — seats often open as families confirm or withdraw.
        </AlertDescription>
      </Alert>
    </div>
  );
}
