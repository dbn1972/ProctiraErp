'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, RefreshCw } from 'lucide-react';

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

interface StaffListFiltersProps {
  filterOptions: {
    institutions: { id: string; name: string }[];
    positions: string[];
  };
  initialValues: {
    search: string;
    institutionId: string;
    position: string;
    status: string;
  };
}

const STATUS_VALUES = ['ALL', 'ACTIVE', 'INACTIVE'];

export function StaffListFilters({ filterOptions, initialValues }: StaffListFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== 'ALL' && value !== '') {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    if (key !== 'page') params.delete('page');
    startTransition(() => {
      router.replace(`/staff?${params.toString()}`);
    });
  }

  function onSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setParam('search', String(formData.get('search') ?? '').trim());
  }

  function onReset() {
    startTransition(() => {
      router.replace('/staff');
    });
  }

  return (
    <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto_auto]">
      <form onSubmit={onSearchSubmit} className="md:col-span-1" role="search">
        <Label htmlFor="staff-search" className="sr-only">
          Search staff
        </Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
            aria-hidden="true"
          />
          <Input
            id="staff-search"
            name="search"
            type="search"
            defaultValue={initialValues.search}
            placeholder="Search by name or identity number"
            className="ps-8"
          />
        </div>
      </form>

      <FilterSelect
        id="filter-institution"
        label="Institution"
        value={initialValues.institutionId || 'ALL'}
        onChange={(value) => setParam('institutionId', value)}
        options={[
          { value: 'ALL', label: 'All institutions' },
          ...filterOptions.institutions.map((i) => ({ value: i.id, label: i.name })),
        ]}
      />

      <FilterSelect
        id="filter-position"
        label="Position"
        value={initialValues.position || 'ALL'}
        onChange={(value) => setParam('position', value)}
        options={[
          { value: 'ALL', label: 'All positions' },
          ...filterOptions.positions.map((p) => ({ value: p, label: p })),
        ]}
      />

      <FilterSelect
        id="filter-status"
        label="Status"
        value={initialValues.status || 'ALL'}
        onChange={(value) => setParam('status', value)}
        options={STATUS_VALUES.map((s) => ({
          value: s,
          label: s === 'ALL' ? 'All statuses' : titleCase(s),
        }))}
      />

      <div className="flex items-end justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onReset} disabled={isPending}>
          <RefreshCw className="me-2 h-4 w-4" aria-hidden="true" />
          Reset
        </Button>
      </div>
    </div>
  );
}

interface FilterSelectProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}

function FilterSelect({ id, label, value, onChange, options }: FilterSelectProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs uppercase text-[hsl(var(--muted-foreground))]">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} aria-label={label}>
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
