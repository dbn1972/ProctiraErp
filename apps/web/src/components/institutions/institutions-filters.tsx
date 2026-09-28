'use client';

import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@proctira/ui/components';

interface AreaOption {
  id: string;
  name: string;
}

export interface InstitutionsFiltersProps {
  areas: AreaOption[];
  defaultSearch: string;
  defaultAreaId: string | undefined;
  defaultStatus: string | undefined;
}

const ALL_AREAS = '__all_areas__';
const ALL_STATUSES = '__all_statuses__';

/**
 * Client-side filter bar that mirrors its state into the URL query string.
 * The list page is a Server Component that re-renders on each `?search=...`
 * or `?areaId=...` change, so this component never fetches data itself.
 */
export function InstitutionsFilters({
  areas,
  defaultSearch,
  defaultAreaId,
  defaultStatus,
}: InstitutionsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(defaultSearch);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setSearchInput(defaultSearch);
  }, [defaultSearch]);

  const navigate = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    params.delete('page');
    const query = params.toString();
    // App Router `router.push(pathname)` keeps the current query string.
    // A cleared filter set has to navigate without that query.
    if (!query) {
      window.location.assign(pathname);
      return;
    }
    startTransition(() => {
      router.push(`${pathname}?${query}`);
    });
  };

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate((params) => {
      const trimmed = searchInput.trim();
      if (trimmed) {
        params.set('search', trimmed);
      } else {
        params.delete('search');
      }
    });
  };

  const handleClear = () => {
    setSearchInput('');
    navigate((params) => {
      params.delete('search');
      params.delete('areaId');
      params.delete('status');
    });
  };

  return (
    <div className="rounded-xl border bg-card px-3 py-3 shadow-sm">
      <form
        onSubmit={handleSearchSubmit}
        className="flex flex-col gap-3 lg:flex-row lg:items-center"
        role="search"
        aria-label="Filter institutions"
      >
        <div className="min-w-0 flex-1">
          <Label htmlFor="search" className="sr-only">
            Search
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="search"
              type="search"
              placeholder="Search by name or code"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              className="h-10 ps-9"
              disabled={isPending}
            />
          </div>
        </div>

        <div className="lg:w-48">
          <Label htmlFor="filter-area" className="sr-only">
            Area
          </Label>
          <Select
            value={defaultAreaId ?? ALL_AREAS}
            onValueChange={(value) =>
              navigate((params) => {
                if (value === ALL_AREAS) {
                  params.delete('areaId');
                } else {
                  params.set('areaId', value);
                }
              })
            }
            disabled={isPending}
          >
            <SelectTrigger id="filter-area" className="h-10">
              <SelectValue placeholder="All areas">
                {areas.find((area) => area.id === defaultAreaId)?.name ?? 'All areas'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_AREAS}>All areas</SelectItem>
              {areas.map((area) => (
                <SelectItem key={area.id} value={area.id}>
                  {area.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="lg:w-44">
          <Label htmlFor="filter-status" className="sr-only">
            Status
          </Label>
          <Select
            value={defaultStatus ?? ALL_STATUSES}
            onValueChange={(value) =>
              navigate((params) => {
                if (value === ALL_STATUSES) {
                  params.delete('status');
                } else {
                  params.set('status', value);
                }
              })
            }
            disabled={isPending}
          >
            <SelectTrigger id="filter-status" className="h-10">
              <SelectValue placeholder="All statuses">
                {defaultStatus === 'ACTIVE'
                  ? 'Active'
                  : defaultStatus === 'INACTIVE'
                    ? 'Inactive'
                    : 'All statuses'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="INACTIVE">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={isPending} className="h-10">
            <Search className="h-4 w-4" aria-hidden="true" /> Search
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={handleClear}
            disabled={isPending}
            aria-label="Clear all filters"
            className="h-10"
          >
            <X className="h-4 w-4" aria-hidden="true" /> Clear
          </Button>
        </div>
      </form>
    </div>
  );
}
